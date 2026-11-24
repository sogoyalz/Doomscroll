export type NotificationResult = 'accepted' | 'permission-required' | 'blocked' | 'failed';

/** Chrome can accept a notification even when the operating system silences its banner. */
export async function showDesktopNotification(
  title: string,
  message: string,
): Promise<NotificationResult> {
  const notifications = chrome.notifications;
  if (!notifications) return 'permission-required';
  try {
    if ((await notifications.getPermissionLevel()) !== 'granted') return 'blocked';
    await notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title,
      message,
      requireInteraction: false,
    });
    return 'accepted';
  } catch (err) {
    console.warn('Doomscroll: notification failed', err);
    return 'failed';
  }
}
