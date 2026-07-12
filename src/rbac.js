/**
 * Capability-based access control.
 *
 * Roles are just named bundles of capabilities. Code checks *capabilities*
 * (can(user, 'campaign:manage')), never role strings directly — so adding a
 * new role, or moving a capability between roles, never touches feature code.
 * This is the "expandable" core: new roles slot in here and nowhere else.
 */

export const CAPABILITIES = /** @type {const} */ ([
  'search', // run searches, browse
  'bookmark', // save bookmarks/themes/history
  'app:install', // add apps to your shelf
  'app:publish', // publish apps to the store (review-gated)
  'campaign:manage', // create/edit ad campaigns + creatives
  'ad:serve', // receive served ads (everyone, incl. guests)
  'moderate', // review apps/ads/flagged content
  'admin', // platform administration
])

/** role -> capabilities. Order also defines seniority for UI badges. */
export const ROLES = {
  guest: ['search', 'ad:serve'],
  consumer: ['search', 'ad:serve', 'bookmark', 'app:install'],
  creator: [
    'search',
    'ad:serve',
    'bookmark',
    'app:install',
    'app:publish',
  ],
  advertiser: [
    'search',
    'ad:serve',
    'bookmark',
    'app:install',
    'campaign:manage',
  ],
  moderator: [
    'search',
    'ad:serve',
    'bookmark',
    'app:install',
    'app:publish',
    'moderate',
  ],
  admin: [...CAPABILITIES], // everything
}

export const ROLE_LABELS = {
  guest: 'Guest',
  consumer: 'Consumer',
  creator: 'Creator',
  advertiser: 'Advertiser',
  moderator: 'Moderator',
  admin: 'Admin',
}

/**
 * @param {{role?: string}|null} user  a profile (or null = signed-out guest)
 * @param {string} capability
 */
export function can(user, capability) {
  const role = user?.role || 'guest'
  const caps = ROLES[role] || ROLES.guest
  return caps.includes(capability)
}

/** All capabilities a user currently holds (handy for debugging/UI). */
export function capabilitiesOf(user) {
  const role = user?.role || 'guest'
  return ROLES[role] || ROLES.guest
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || 'Guest'
}
