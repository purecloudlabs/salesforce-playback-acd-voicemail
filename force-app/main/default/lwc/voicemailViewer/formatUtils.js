/**
 * Formatting utilities for voicemail display
 */

export function formatDuration(durationSeconds) {
    if (!durationSeconds) return '0:00';
    const minutes = Math.floor(durationSeconds / 60);
    const remainingSeconds = durationSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString();
}

export function getRelativeTime(dateString) {
    if (!dateString) return '';
    const diffMs = new Date() - new Date(dateString);
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    const hours = Math.floor(minutes / 60);
    if (hours < 1) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function getCardClass(isRead, isExpanded) {
    const baseClass = 'slds-card slds-m-bottom_small';
    const readClass = isRead ? 'read-card' : 'unread-card';
    const expandedClass = isExpanded ? 'expanded-card' : '';
    return `${baseClass} ${readClass} ${expandedClass}`.trim();
}

export function extractPhoneNumber(callerAddress) {
    if (!callerAddress) return null;
    const match = callerAddress.match(/\+?\d[\d\s\-\(\)]+/);
    return match ? match[0].replace(/[\s\-\(\)]/g, '') : null;
}

export function parseValueBetweenColons(inputString) {
    if (!inputString) return null;
    const firstColonIndex = inputString.indexOf(':');
    if (firstColonIndex === -1) return null;
    const secondColonIndex = inputString.indexOf(':', firstColonIndex + 1);
    if (secondColonIndex === -1) return null;
    return inputString.substring(firstColonIndex + 1, secondColonIndex);
}
