import type { FriendRequestStatus, FriendshipAction, FriendshipSummary } from '@/social/types';

export function friendInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  return [words[0], words.length > 1 ? words[words.length - 1] : undefined]
    .map(word => word ? Array.from(word)[0] : '').join('').toLocaleUpperCase();
}

export function validDisplayName(value: string): boolean {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return Array.from(normalized).length >= 1 && Array.from(normalized).length <= 60;
}

export function displayInviteCode(code: string): string {
  return code.match(/.{1,4}/g)?.join(' ') ?? code;
}

export const REQUEST_STATUS: Record<FriendRequestStatus, { title: string; message: string; success: boolean }> = {
  sent: { title: 'Request sent', message: 'They can accept your request in Friends.', success: true },
  incoming: { title: 'They already invited you', message: 'Accept their request below to become friends.', success: true },
  outgoing: { title: 'Request already sent', message: 'Your request is still waiting for their reply.', success: true },
  accepted: { title: 'You are already friends', message: 'Open their profile in your friends list.', success: true },
  unavailable: { title: 'That code is unavailable', message: 'Check the code with your friend and try again.', success: false },
  rate_limited: { title: 'Please wait before trying again', message: 'Too many requests were made. Keep the code and try again later.', success: false },
};

export function relationshipActions(state: FriendshipSummary['state']): { action: FriendshipAction; label: string }[] {
  switch (state) {
    case 'incoming': return [{ action: 'accept', label: 'Accept' }, { action: 'decline', label: 'Decline' }, { action: 'block', label: 'Block' }];
    case 'outgoing': return [{ action: 'cancel', label: 'Cancel request' }, { action: 'block', label: 'Block' }];
    case 'accepted': return [{ action: 'remove', label: 'Remove friend' }, { action: 'block', label: 'Block' }];
    case 'blocked': return [{ action: 'unblock', label: 'Unblock' }];
  }
}
