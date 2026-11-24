export type NotificationResult = 'accepted' | 'permission-required' | 'blocked' | 'failed';

/** Chrome can accept a notification even when the operating system silences its banner. */
export async function showDesktopNotification(
  title: string,
  message: string,
  id?: string,
): Promise<NotificationResult> {
  const notifications = chrome.notifications;
  if (!notifications) return 'permission-required';
  try {
    if ((await notifications.getPermissionLevel()) !== 'granted') return 'blocked';
    const options: chrome.notifications.NotificationCreateOptions = {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title,
      message,
      requireInteraction: false,
    };
    if (id) await notifications.create(id, options);
    else await notifications.create(options);
    return 'accepted';
  } catch (err) {
    console.warn('Doomscroll: notification failed', err);
    return 'failed';
  }
}
