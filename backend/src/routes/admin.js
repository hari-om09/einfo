const express = require('express');
const { body, param, query } = require('express-validator');
const adminController = require('../controllers/admin');
const { adminAuth, superAdminOnly } = require('../middleware/adminAuth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

/**
 * @route   POST /api/admin/login
 * @desc    Admin login
 * @access  Public
 */
router.post('/login', [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  handleValidationErrors
], adminController.login);

/**
 * @route   POST /api/admin/request-reset
 * @desc    Request password reset email
 * @access  Public
 */
router.post('/request-reset', [
  body('email').isEmail().withMessage('Please provide a valid email').normalizeEmail(),
  handleValidationErrors
], adminController.requestPasswordReset);

/**
 * @route   POST /api/admin/reset-password
 * @desc    Confirm password reset with token
 * @access  Public
 */
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  handleValidationErrors
], adminController.confirmPasswordReset);

/**
 * @route   POST /api/admin/logout
 * @desc    Admin logout
 * @access  Private (Admin)
 */
router.post('/logout', adminAuth, adminController.logout);

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get admin dashboard data
 * @access  Private (Admin)
 */
router.get('/dashboard', adminAuth, adminController.getDashboard);

/**
 * @route   GET /api/admin/users
 * @desc    Get paginated list of users
 * @access  Private (Admin)
 */
router.get('/users', [
  adminAuth,
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('search')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Search term too long'),
  query('status')
    .optional()
    .isIn(['active', 'inactive'])
    .withMessage('Status must be either active or inactive'),
  handleValidationErrors
], adminController.getUsers);

/**
 * @route   GET /api/admin/users/:userId
 * @desc    Get detailed user information
 * @access  Private (Admin)
 */
router.get('/users/:userId', [
  adminAuth,
  param('userId')
    .isLength({ min: 1 })
    .withMessage('User ID is required'),
  handleValidationErrors
], adminController.getUserDetails);

/**
 * @route   PUT /api/admin/users/:userId/status
 * @desc    Toggle user active status
 * @access  Private (Admin)
 */
router.put('/users/:userId/status', [
  adminAuth,
  param('userId')
    .isLength({ min: 1 })
    .withMessage('User ID is required'),
  body('isActive')
    .isBoolean()
    .withMessage('isActive must be a boolean value'),
  handleValidationErrors
], adminController.toggleUserStatus);

/**
 * @route   POST /api/admin/create-admin
 * @desc    Create new admin (Super admin only)
 * @access  Private (Super Admin)
 */
router.post('/create-admin', [
  adminAuth,
  superAdminOnly,
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('username')
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('name')
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  body('role')
    .optional()
    .isIn(['admin', 'super_admin'])
    .withMessage('Role must be either admin or super_admin'),
  handleValidationErrors
], adminController.createAdmin);

/**
 * @route   GET /api/admin/activity-logs
 * @desc    Get admin activity logs
 * @access  Private (Admin)
 */
router.get('/activity-logs', [
  adminAuth,
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('action')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Action filter too long'),
  query('adminId')
    .optional()
    .isLength({ min: 1 })
    .withMessage('Admin ID must be provided'),
  handleValidationErrors
], adminController.getActivityLogs);

module.exports = router;
