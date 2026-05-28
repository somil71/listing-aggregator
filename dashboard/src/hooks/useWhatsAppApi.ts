import { useAuth } from '@clerk/react';

export function useWhatsAppApi() {
  const { getToken } = useAuth();

  const authHeaders = async (): Promise<HeadersInit> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await getToken()}`,
  });

  return {
    async initiateQR() {
      const res = await fetch('/api/v1/whatsapp/initiate-qr', {
        method: 'POST',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to initiate QR');
      return res.json();
    },

    async getStatus() {
      const res = await fetch('/api/v1/whatsapp/status', {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to get status');
      return res.json();
    },

    async getGroups() {
      const res = await fetch('/api/v1/whatsapp/groups', {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to get groups');
      return res.json();
    },

    async selectGroups(groupIds: string[], groupNames: string[]) {
      const res = await fetch('/api/v1/whatsapp/select-groups', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ groupIds, groupNames }),
      });
      if (!res.ok) throw new Error('Failed to select groups');
      return res.json();
    },

    async disconnect() {
      const res = await fetch('/api/v1/whatsapp/disconnect', {
        method: 'POST',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      return res.json();
    },

    async rescrape() {
      const res = await fetch('/api/v1/whatsapp/rescrape', {
        method: 'POST',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to start rescrape');
      return res.json();
    },

    // Exchange a fresh Clerk JWT for a short-lived one-time SSE nonce.
    // The nonce is passed as ?token= so the full JWT never appears in URLs,
    // browser history, or server access logs.
    async getStreamUrl(): Promise<string> {
      const token = await getToken();
      if (!token) throw new Error('No auth token available');
      const res = await fetch('/api/v1/whatsapp/sse-token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to get SSE token');
      const { data } = await res.json();
      return `/api/v1/whatsapp/qr-stream?token=${data.token}`;
    },
  };
}
