// AuthenticatedMedia — fetches an auth-gated media file (image or video) using
// the Clerk JWT token and creates an object URL from the blob response.
//
// WHY: Browser <img src> and <video src> requests never send custom headers, so
// they're silently rejected by the authenticate() middleware with 401.
// This component uses fetch() — which CAN send an Authorization header —
// then creates a local blob URL that the browser loads without an auth check.

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';

interface Props {
  /** The auth-gated API URL, e.g. /api/media/file.jpg */
  src: string;
  isVideo?: boolean;
  className?: string;
  /** Receives the blob object URL when the user clicks an image (for lightbox) */
  onClick?: (objectUrl: string) => void;
  alt?: string;
}

const AuthenticatedMedia: React.FC<Props> = ({
  src, isVideo = false, className = '', onClick, alt = 'Property media',
}) => {
  const { getToken } = useAuth();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus]       = useState<'loading' | 'ready' | 'error'>('loading');
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const resp  = await fetch(src, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) { if (!cancelled) setStatus('error'); return; }
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        urlRef.current = url;
        if (!cancelled) { setObjectUrl(url); setStatus('ready'); }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      // Revoke the object URL when the component unmounts to free memory
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [src]);

  if (status === 'error') return null;

  if (status === 'loading') {
    return (
      <div
        className={`animate-pulse bg-slate-200 rounded-2xl ${isVideo ? 'w-48 h-32' : 'w-32 h-32'}`}
      />
    );
  }

  if (isVideo) {
    return (
      <video
        src={objectUrl!}
        controls
        className={className || 'rounded-2xl max-h-64 border border-slate-200 bg-black'}
      />
    );
  }

  return (
    <img
      src={objectUrl!}
      alt={alt}
      className={className || 'rounded-2xl max-h-64 object-cover border border-slate-200 cursor-zoom-in hover:opacity-90 transition-opacity'}
      onClick={() => objectUrl && onClick?.(objectUrl)}
    />
  );
};

export default AuthenticatedMedia;
