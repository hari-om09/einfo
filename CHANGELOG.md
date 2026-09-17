# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Auth & Security Overhaul] - 2026-09-17 (22:45 IST)

### 🔐 Security Patches
- **Upgraded Multer:** Bumped the `multer` dependency from `1.4.5-lts.1` to `^2.0.0-rc.4` to patch known critical security vulnerabilities related to file uploads.
- **Enhanced Token Validation:** Modified the `logout` functionality to explicitly invalidate refresh tokens in the database, fully preventing stolen token reuse.

### ✨ Added Features
- **Dual-Token Authentication Flow:** Implemented an HTTP-Only cookie `refresh_token` system alongside the existing JWT `access_token` to securely maintain user sessions without exposing tokens to XSS attacks.
- **Admin Password Reset:** Implemented `request-reset` and `reset-password` API endpoints to allow admins to securely recover their accounts via email links.
- **Frontend Token Interceptor:** Upgraded the `apiClient.ts` to automatically catch `401 Unauthorized` responses, silently fetch a new access token using the HTTP-Only refresh cookie, and seamlessly retry the original request.

### 🗄️ Database Changes
- **`RefreshToken` Model:** Added to track and manage active refresh sessions.
- **`AdminResetToken` Model:** Added to facilitate secure, temporary password reset links for administrators.
