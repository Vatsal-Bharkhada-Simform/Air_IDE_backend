const { nanoid } = require('nanoid');

/**
 * Generate a short, URL-safe invite code for sessions.
 * Format: "abc-xyz-123" (3 groups of 3 characters separated by dashes)
 *
 * @returns {string} A unique invite code
 */
function generateInviteCode() {
  const raw = nanoid(9); // 9 alphanumeric characters
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 9)}`.toLowerCase();
}

/**
 * Predefined cursor colors for session participants.
 * Each user joining a session gets a unique color (cycles if >10 users).
 */
const CURSOR_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Sky blue
  '#96CEB4', // Sage green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#98D8C8', // Mint
  '#F7DC6F', // Gold
  '#BB8FCE', // Purple
  '#85C1E9', // Light blue
];

/**
 * Assign a cursor color based on the user's index within a session.
 *
 * @param {number} index - The user's position in the session (0-based)
 * @returns {string} A hex color code
 */
function assignCursorColor(index) {
  return CURSOR_COLORS[index % CURSOR_COLORS.length];
}

module.exports = {
  generateInviteCode,
  assignCursorColor,
  CURSOR_COLORS,
};
