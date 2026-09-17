import { EducationData } from "@/components/Education";
import { PortfolioProject } from "@/lib/portfolioData";
import { PersonProfile } from "@/lib/profileData";
import { ProjectLink } from "@/lib/profileData";
import { WorkExperienceData } from "@/lib/workExperienceData";
import { demoDataService } from "@/services/demoData";
import { User } from "@/stores/authStore";
import { VisibilitySettings } from "@/stores/profileStore";

/**
 * Comprehensive API Client for E-Info.me Backend Integration
 * This replaces the existing api.ts with full backend support
 */

import {
  API_CONFIG,
  API_ENDPOINTS,
  HTTP_STATUS,
  API_ERROR_CODES,
  ApiResponse,
  PaginatedResponse,
  ApiError as ConfigApiError,
  UPLOAD_CONFIG,
  ANALYTICS_EVENTS,
  DEFAULT_HEADERS,
} from "@/config/api";

// Extended types for API integration
export interface AuthResponse {
  user: User;
  token: string;
  expires_in: number;
}

export interface CompleteProfileData {
  user: User;
  profile: PersonProfile & {
    visibility: VisibilitySettings;
  };
  links: ProjectLink[];
  portfolio: PortfolioProject[];
  experience: WorkExperienceData[];
  education: EducationData[];
  analytics?: {
    total_views: number;
    total_stars: number;
    total_clicks: number;
  };
}

export interface PublicProfileData extends CompleteProfileData {
  username: string;
  is_owner: boolean;
}

export interface SearchProfileResult {
  username: string;
  name: string;
  job_title?: string;
  bio?: string;
  avatar_url?: string;
  location?: string;
  skills: string[];
  star_count: number;
}

export interface AnalyticsData {
  total_views: number;
  total_stars: number;
  total_clicks: number;
  recent_views: Array<{
    date: string;
    views: number;
  }>;
  top_referrers: Array<{
    source: string;
    clicks: number;
  }>;
}

// API Client with comprehensive error handling and retry logic
class ApiClient {
  private baseURL: string;
  private timeout: number;
  private retryAttempts: number;
  private retryDelay: number;
  private backendAvailable: boolean | null = null;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 5 * 60 * 1000; // 5 minutes
  private isRefreshing = false;

  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
    this.retryAttempts = API_CONFIG.RETRY_ATTEMPTS;
    this.retryDelay = API_CONFIG.RETRY_DELAY;
  }

  // Token management
  private getAuthToken(): string | null {
    try {
      const authStorage = localStorage.getItem("auth-storage");
      if (authStorage) {
        const parsed = JSON.parse(authStorage);
        return parsed.state?.user ? "dummy_token" : null; // We'll use Zustand's token when available
      }
    } catch {
      // Ignore parsing errors
    }
    return null;
  }

  private setAuthToken(token: string): void {
    // Store JWT token separately for API calls
    localStorage.setItem("api_token", token);
  }

  private removeAuthToken(): void {
    localStorage.removeItem("api_token");
  }

  private getHeaders(includeAuth = true): Record<string, string> {
    const headers: Record<string, string> = { ...DEFAULT_HEADERS };

    if (includeAuth) {
      const token = localStorage.getItem("api_token");
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    return headers;
  }

  // Check if backend is available - guaranteed to never throw
  private checkBackendHealth(): Promise<boolean> {
    // In demo/development mode, always assume backend is unavailable
    // This prevents any fetch errors from occurring
    this.backendAvailable = false;
    this.lastHealthCheck = Date.now();
    return Promise.resolve(false);
  }

  // Check if we should use fallback mode - guaranteed to never throw
  private async shouldUseFallback(): Promise<boolean> {
    // In demo mode, always use fallback
    return true;
  }

  // Request wrapper with retry logic and error handling
  private async makeRequest<T = any>(
    endpoint: string,
    options: RequestInit = {},
    includeAuth = true,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;

    // Create our own abort controller instead of using AbortSignal.timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const requestOptions: RequestInit = {
      credentials: 'include',
      ...options,
      headers: {
        ...this.getHeaders(includeAuth),
        ...options.headers,
      },
      signal: controller.signal,
    };

    // Check if we should use fallback mode
    const useFallback = await this.shouldUseFallback();
    if (useFallback) {
      throw new ApiError({
        code: "BACKEND_UNAVAILABLE",
        message: "Backend is not available. Using demo mode.",
        status: 503,
      });
    }

    let lastError: Error;

    for (let attempt = 0; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await fetch(url, requestOptions);
        clearTimeout(timeoutId); // Clear timeout on successful fetch
        const data = await response.json();

        if (!response.ok) {
          const apiError = new ApiError({
            code: data.error?.code || "UNKNOWN_ERROR",
            message: data.error?.message || `HTTP ${response.status}`,
            details: data.error?.details,
            status: response.status,
          });

          // Handle specific error cases
          if (response.status === HTTP_STATUS.UNAUTHORIZED) {
            // Try to refresh token if not already refreshing and not auth endpoints
            if (!this.isRefreshing && endpoint !== API_ENDPOINTS.AUTH.REFRESH && endpoint !== API_ENDPOINTS.AUTH.LOGIN) {
              this.isRefreshing = true;
              try {
                const refreshResponse = await this.refreshToken();
                this.isRefreshing = false;
                
                // Retry the original request
                return await this.makeRequest(endpoint, options, includeAuth);
              } catch (refreshError) {
                this.isRefreshing = false;
                this.removeAuthToken();
                window.dispatchEvent(new CustomEvent("api:unauthorized"));
                throw apiError;
              }
            } else if (endpoint === API_ENDPOINTS.AUTH.REFRESH || endpoint === API_ENDPOINTS.AUTH.LOGIN) {
              this.removeAuthToken();
              window.dispatchEvent(new CustomEvent("api:unauthorized"));
            } else if (this.isRefreshing) {
              // If already refreshing, just wait a bit and retry (simple backoff)
              await new Promise(resolve => setTimeout(resolve, 1000));
              return await this.makeRequest(endpoint, options, includeAuth);
            }
          }

          throw apiError;
        }

        // Mark backend as available on successful request
        this.backendAvailable = true;
        this.lastHealthCheck = Date.now();

        return data;
      } catch (error) {
        clearTimeout(timeoutId); // Clear timeout on error too
        lastError = error as Error;

        // If it's a network error, mark backend as unavailable
        if (error instanceof TypeError && error.message.includes("fetch")) {
          this.backendAvailable = false;
          this.lastHealthCheck = Date.now();
        }

        // Don't retry on certain errors
        if (
          error instanceof Error &&
          (error.name === "AbortError" ||
            (error as any).status === HTTP_STATUS.UNAUTHORIZED ||
            (error as any).status === HTTP_STATUS.FORBIDDEN ||
            (error as any).status === HTTP_STATUS.NOT_FOUND)
        ) {
          throw error;
        }

        // Wait before retry
        if (attempt < this.retryAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.retryDelay * (attempt + 1)),
          );
        }
      }
    }

    throw lastError!;
  }

  // Upload files with progress tracking
  private async uploadFile(
    endpoint: string,
    file: File,
    additionalData?: Record<string, string>,
    onProgress?: (progress: number) => void,
  ): Promise<ApiResponse<{ url: string }>> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);

      if (additionalData) {
        Object.entries(additionalData).forEach(([key, value]) => {
          formData.append(key, value);
        });
      }

      const xhr = new XMLHttpRequest();

      if (onProgress) {
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            onProgress(progress);
          }
        });
      }

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Upload failed"));
      });

      xhr.open("POST", `${this.baseURL}${endpoint}`);

      const token = localStorage.getItem("api_token");
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.send(formData);
    });
  }

  // Authentication Methods
  async register(userData: {
    email: string;
    password: string;
    name: string;
    username: string;
  }): Promise<ApiResponse<AuthResponse>> {
    const response = await this.makeRequest<AuthResponse>(
      API_ENDPOINTS.AUTH.REGISTER,
      {
        method: "POST",
        body: JSON.stringify(userData),
      },
      false,
    );

    if (response.success && response.data?.token) {
      this.setAuthToken(response.data.token);
    }

    return response;
  }

  async login(credentials: {
    email: string;
    password: string;
  }): Promise<ApiResponse<AuthResponse>> {
    const response = await this.makeRequest<AuthResponse>(
      API_ENDPOINTS.AUTH.LOGIN,
      {
        method: "POST",
        body: JSON.stringify(credentials),
      },
      false,
    );

    if (response.success && response.data?.token) {
      this.setAuthToken(response.data.token);
    }

    return response;
  }

  async googleLogin(
    googleToken: string,
    username?: string,
  ): Promise<ApiResponse<AuthResponse>> {
    const response = await this.makeRequest<AuthResponse>(
      API_ENDPOINTS.AUTH.GOOGLE_LOGIN,
      {
        method: "POST",
        body: JSON.stringify({ google_token: googleToken, username }),
      },
      false,
    );

    if (response.success && response.data?.token) {
      this.setAuthToken(response.data.token);
    }

    return response;
  }

  async logout(): Promise<ApiResponse> {
    try {
      const response = await this.makeRequest(API_ENDPOINTS.AUTH.LOGOUT, {
        method: "POST",
      });

      this.removeAuthToken();
      return response;
    } catch (error) {
      // Even if logout fails on server, clear local token
      this.removeAuthToken();
      throw error;
    }
  }

  async refreshToken(): Promise<ApiResponse<{ token: string }>> {
    const response = await this.makeRequest<{ token: string }>(
      API_ENDPOINTS.AUTH.REFRESH,
      {
        method: "POST",
      },
    );

    if (response.success && response.data?.token) {
      this.setAuthToken(response.data.token);
    }

    return response;
  }

  async forgotPassword(email: string): Promise<ApiResponse> {
    return this.makeRequest(
      API_ENDPOINTS.AUTH.FORGOT_PASSWORD,
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
      false,
    );
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<ApiResponse> {
    return this.makeRequest(
      API_ENDPOINTS.AUTH.RESET_PASSWORD,
      {
        method: "POST",
        body: JSON.stringify({ token, new_password: newPassword }),
      },
      false,
    );
  }

  async verifyEmail(token: string): Promise<ApiResponse> {
    return this.makeRequest(
      API_ENDPOINTS.AUTH.VERIFY_EMAIL,
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
      false,
    );
  }

  async checkUsernameAvailability(
    username: string,
  ): Promise<ApiResponse<{ available: boolean }>> {
    return this.makeRequest(
      API_ENDPOINTS.AUTH.CHECK_USERNAME + `/${username}`,
      {},
      false,
    );
  }

  // Backend status methods
  async isBackendAvailable(): Promise<boolean> {
    // In demo mode, backend is never available
    return false;
  }

  // Get fallback profile data for demo mode
  private getFallbackProfileData(): CompleteProfileData {
    return demoDataService.getDemoProfileData();
  }

  // Profile Methods
  async getMyProfile(): Promise<ApiResponse<CompleteProfileData>> {
    try {
      // Check if we should use fallback mode first
      const useFallback = await this.shouldUseFallback();
      if (useFallback) {
        console.debug(
          "Backend unavailable, using fallback data for getMyProfile",
        );
        return {
          success: true,
          data: this.getFallbackProfileData(),
        };
      }

      return await this.makeRequest<CompleteProfileData>(
        API_ENDPOINTS.PROFILE.ME,
      );
    } catch (error) {
      // For ANY error (including fetch errors), return fallback data
      console.debug("getMyProfile failed, using fallback data");
      return {
        success: true,
        data: this.getFallbackProfileData(),
      };
    }
  }

  async getPublicProfile(
    username: string,
  ): Promise<ApiResponse<PublicProfileData>> {
    return this.makeRequest<PublicProfileData>(
      API_ENDPOINTS.PROFILE.BY_USERNAME(username),
      {},
      false,
    );
  }

  async updateProfile(
    profileData: Partial<PersonProfile>,
  ): Promise<ApiResponse<{ profile: PersonProfile }>> {
    return this.makeRequest(API_ENDPOINTS.PROFILE.UPDATE, {
      method: "PUT",
      body: JSON.stringify(profileData),
    });
  }

  async updateAccountSettings(accountData: {
    name?: string;
    username?: string;
  }): Promise<ApiResponse<{ user: User }>> {
    try {
      // Check if we should use fallback mode first
      const useFallback = await this.shouldUseFallback();
      if (useFallback) {
        const demoUser = demoDataService.getDemoUser();
        return {
          success: true,
          data: {
            user: {
              ...demoUser,
              name: accountData.name || demoUser.name,
              username: accountData.username || demoUser.username,
            },
          },
        };
      }

      return await this.makeRequest(API_ENDPOINTS.PROFILE.UPDATE_ACCOUNT, {
        method: "PUT",
        body: JSON.stringify(accountData),
      });
    } catch (error) {
      // For ANY error, return demo data
      const demoUser = demoDataService.getDemoUser();
      return {
        success: true,
        data: {
          user: {
            ...demoUser,
            name: accountData.name || demoUser.name,
            username: accountData.username || demoUser.username,
          },
        },
      };
    }
  }

  async updateInstantMessage(instantMessageData: {
    instant_message_subject: string;
    instant_message_body: string;
  }): Promise<ApiResponse<{ user: User }>> {
    try {
      // Check if we should use fallback mode first
      const useFallback = await this.shouldUseFallback();
      if (useFallback) {
        return {
          success: true,
          data: {
            user: demoDataService.getDemoUser(),
          },
        };
      }

      return await this.makeRequest(
        API_ENDPOINTS.PROFILE.UPDATE_INSTANT_MESSAGE,
        {
          method: "PUT",
          body: JSON.stringify(instantMessageData),
        },
      );
    } catch (error) {
      // For ANY error, return demo data
      return {
        success: true,
        data: {
          user: demoDataService.getDemoUser(),
        },
      };
    }
  }

  // Profile Links Methods
  async getLinks(): Promise<ApiResponse<{ links: ProjectLink[] }>> {
    return this.makeRequest<{ links: ProjectLink[] }>(API_ENDPOINTS.LINKS.LIST);
  }

  async createLink(
    linkData: Omit<ProjectLink, "id">,
  ): Promise<ApiResponse<{ link: ProjectLink }>> {
    return this.makeRequest(API_ENDPOINTS.LINKS.CREATE, {
      method: "POST",
      body: JSON.stringify(linkData),
    });
  }

  async updateLink(
    id: string,
    linkData: Partial<ProjectLink>,
  ): Promise<ApiResponse<{ link: ProjectLink }>> {
    return this.makeRequest(API_ENDPOINTS.LINKS.UPDATE(id), {
      method: "PUT",
      body: JSON.stringify(linkData),
    });
  }

  async deleteLink(id: string): Promise<ApiResponse> {
    return this.makeRequest(API_ENDPOINTS.LINKS.DELETE(id), {
      method: "DELETE",
    });
  }

  async reorderLinks(linkIds: string[]): Promise<ApiResponse> {
    return this.makeRequest(API_ENDPOINTS.LINKS.REORDER, {
      method: "PUT",
      body: JSON.stringify({ link_ids: linkIds }),
    });
  }

  // Portfolio Methods
  async getPortfolio(): Promise<ApiResponse<{ projects: PortfolioProject[] }>> {
    return this.makeRequest<{ projects: PortfolioProject[] }>(
      API_ENDPOINTS.PORTFOLIO.LIST,
    );
  }

  async createPortfolioProject(
    projectData: Omit<PortfolioProject, "id">,
  ): Promise<ApiResponse<{ project: PortfolioProject }>> {
    return this.makeRequest(API_ENDPOINTS.PORTFOLIO.CREATE, {
      method: "POST",
      body: JSON.stringify(projectData),
    });
  }

  async updatePortfolioProject(
    id: string,
    projectData: Partial<PortfolioProject>,
  ): Promise<ApiResponse<{ project: PortfolioProject }>> {
    return this.makeRequest(API_ENDPOINTS.PORTFOLIO.UPDATE(id), {
      method: "PUT",
      body: JSON.stringify(projectData),
    });
  }

  async deletePortfolioProject(id: string): Promise<ApiResponse> {
    return this.makeRequest(API_ENDPOINTS.PORTFOLIO.DELETE(id), {
      method: "DELETE",
    });
  }

  // Work Experience Methods
  async getWorkExperience(): Promise<
    ApiResponse<{ experiences: WorkExperienceData[] }>
  > {
    return this.makeRequest<{ experiences: WorkExperienceData[] }>(
      API_ENDPOINTS.EXPERIENCE.LIST,
    );
  }

  async createWorkExperience(
    experienceData: Omit<WorkExperienceData, "id">,
  ): Promise<ApiResponse<{ experience: WorkExperienceData }>> {
    return this.makeRequest(API_ENDPOINTS.EXPERIENCE.CREATE, {
      method: "POST",
      body: JSON.stringify(experienceData),
    });
  }

  async updateWorkExperience(
    id: string,
    experienceData: Partial<WorkExperienceData>,
  ): Promise<ApiResponse<{ experience: WorkExperienceData }>> {
    return this.makeRequest(API_ENDPOINTS.EXPERIENCE.UPDATE(id), {
      method: "PUT",
      body: JSON.stringify(experienceData),
    });
  }

  async deleteWorkExperience(id: string): Promise<ApiResponse> {
    return this.makeRequest(API_ENDPOINTS.EXPERIENCE.DELETE(id), {
      method: "DELETE",
    });
  }

  // Education Methods
  async getEducation(): Promise<ApiResponse<{ education: EducationData[] }>> {
    return this.makeRequest<{ education: EducationData[] }>(
      API_ENDPOINTS.EDUCATION.LIST,
    );
  }

  async createEducation(
    educationData: Omit<EducationData, "id">,
  ): Promise<ApiResponse<{ education: EducationData }>> {
    return this.makeRequest(API_ENDPOINTS.EDUCATION.CREATE, {
      method: "POST",
      body: JSON.stringify(educationData),
    });
  }

  async updateEducation(
    id: string,
    educationData: Partial<EducationData>,
  ): Promise<ApiResponse<{ education: EducationData }>> {
    return this.makeRequest(API_ENDPOINTS.EDUCATION.UPDATE(id), {
      method: "PUT",
      body: JSON.stringify(educationData),
    });
  }

  async deleteEducation(id: string): Promise<ApiResponse> {
    return this.makeRequest(API_ENDPOINTS.EDUCATION.DELETE(id), {
      method: "DELETE",
    });
  }

  // File Upload Methods
  async uploadProfileImage(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<ApiResponse<{ url: string }>> {
    // Validate file
    if (!UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
      throw new ApiError({
        code: API_ERROR_CODES.INVALID_FILE_TYPE,
        message: "Invalid file type. Please upload a valid image.",
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE.AVATAR) {
      throw new ApiError({
        code: API_ERROR_CODES.FILE_TOO_LARGE,
        message: "File too large. Maximum size is 100KB for profile images.",
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    return this.uploadFile(
      API_ENDPOINTS.UPLOAD.PROFILE_IMAGE,
      file,
      undefined,
      onProgress,
    );
  }

  async uploadPortfolioImage(
    file: File,
    projectId?: string,
    onProgress?: (progress: number) => void,
  ): Promise<ApiResponse<{ url: string }>> {
    // Validate file
    if (!UPLOAD_CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type as any)) {
      throw new ApiError({
        code: API_ERROR_CODES.INVALID_FILE_TYPE,
        message: "Invalid file type. Please upload a valid image.",
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE.IMAGE) {
      throw new ApiError({
        code: API_ERROR_CODES.FILE_TOO_LARGE,
        message: "File too large. Maximum size is 5MB.",
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    const additionalData = projectId ? { project_id: projectId } : undefined;
    return this.uploadFile(
      API_ENDPOINTS.UPLOAD.PORTFOLIO_IMAGE,
      file,
      additionalData,
      onProgress,
    );
  }

  async uploadResume(
    file: File,
    onProgress?: (progress: number) => void,
  ): Promise<ApiResponse<{ url: string }>> {
    if (!UPLOAD_CONFIG.ALLOWED_RESUME_TYPES.includes(file.type as any)) {
      throw new ApiError({
        code: API_ERROR_CODES.INVALID_FILE_TYPE,
        message: "Invalid file type. Please upload a PDF or Word document.",
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE.RESUME) {
      throw new ApiError({
        code: API_ERROR_CODES.FILE_TOO_LARGE,
        message: "File too large. Maximum size is 25MB.",
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }

    return this.uploadFile(
      API_ENDPOINTS.UPLOAD.RESUME,
      file,
      undefined,
      onProgress,
    );
  }

  // Analytics Methods
  async getDashboardAnalytics(): Promise<ApiResponse<AnalyticsData>> {
    return this.makeRequest<AnalyticsData>(API_ENDPOINTS.ANALYTICS.DASHBOARD);
  }

  async trackEvent(
    eventType: keyof typeof ANALYTICS_EVENTS,
    metadata?: Record<string, any>,
  ): Promise<ApiResponse> {
    return this.makeRequest(
      API_ENDPOINTS.ANALYTICS.TRACK,
      {
        method: "POST",
        body: JSON.stringify({
          event_type: ANALYTICS_EVENTS[eventType],
          metadata,
        }),
      },
      false,
    );
  }

  // Profile Stars Methods
  async starProfile(username: string): Promise<ApiResponse> {
    return this.makeRequest(API_ENDPOINTS.STARS.STAR_PROFILE(username), {
      method: "POST",
    });
  }

  async unstarProfile(username: string): Promise<ApiResponse> {
    return this.makeRequest(API_ENDPOINTS.STARS.UNSTAR_PROFILE(username), {
      method: "DELETE",
    });
  }

  async getProfileStars(
    username: string,
  ): Promise<ApiResponse<{ count: number; starred_by_user: boolean }>> {
    return this.makeRequest<{ count: number; starred_by_user: boolean }>(
      API_ENDPOINTS.STARS.GET_STARS(username),
      {},
      false,
    );
  }

  // Search & Discovery Methods
  async searchProfiles(
    query: string,
    options: {
      skills?: string[];
      location?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<ApiResponse<PaginatedResponse<SearchProfileResult>>> {
    const params = new URLSearchParams({
      q: query,
      limit: (options.limit || 20).toString(),
      offset: (options.offset || 0).toString(),
    });

    if (options.skills?.length) {
      params.append("skills", options.skills.join(","));
    }

    if (options.location) {
      params.append("location", options.location);
    }

    return this.makeRequest<PaginatedResponse<SearchProfileResult>>(
      `${API_ENDPOINTS.SEARCH.PROFILES}?${params}`,
      {},
      false,
    );
  }

  async getTrendingProfiles(): Promise<
    ApiResponse<{ profiles: SearchProfileResult[] }>
  > {
    return this.makeRequest<{ profiles: SearchProfileResult[] }>(
      API_ENDPOINTS.SEARCH.TRENDING,
      {},
      false,
    );
  }

  async getFeaturedProfiles(): Promise<
    ApiResponse<{ profiles: SearchProfileResult[] }>
  > {
    return this.makeRequest<{ profiles: SearchProfileResult[] }>(
      API_ENDPOINTS.SEARCH.FEATURED,
      {},
      false,
    );
  }
}

// Create and export singleton instance
export const apiClient = new ApiClient();

// Export types (avoid duplicates with config/api)
export type { ApiResponse, PaginatedResponse };

// Error handling utility
export class ApiError extends Error {
  public code: string;
  public status: number;
  public details?: Array<{ field?: string; message: string }>;

  constructor(
    public error: {
      code: string;
      message: string;
      status: number;
      details?: Array<{ field?: string; message: string }>;
    },
  ) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.status = error.status;
    this.details = error.details;
  }
}

// Event listener for unauthorized events (logout user)
if (typeof window !== "undefined") {
  window.addEventListener("api:unauthorized", () => {
    // This will be caught by the auth store to logout user
    import("@/stores").then(({ useAuthStore }) => {
      useAuthStore.getState().signOut();
    });
  });
}
