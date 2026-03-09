'use client';

import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

// ============================================
// TOAST CONFIGURATION
// ============================================

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      duration={5000}
      toastOptions={{
        style: {
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        },
      }}
    />
  );
}

// ============================================
// TOAST HELPERS
// ============================================

export const toast = {
  success: (message: string, description?: string) => {
    sonnerToast.success(message, {
      description,
    });
  },

  error: (message: string, description?: string) => {
    sonnerToast.error(message, {
      description,
    });
  },

  warning: (message: string, description?: string) => {
    sonnerToast.warning(message, {
      description,
    });
  },

  info: (message: string, description?: string) => {
    sonnerToast.info(message, {
      description,
    });
  },

  loading: (message: string, description?: string) => {
    return sonnerToast.loading(message, {
      description,
    });
  },

  dismiss: (toastId: string | number) => {
    sonnerToast.dismiss(toastId);
  },

  promise: <T>(
    promise: Promise<T>,
    {
      loading,
      success,
      error,
    }: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: Error) => string);
    }
  ) => {
    return sonnerToast.promise(promise, {
      loading,
      success,
      error,
    });
  },
};

// ============================================
// USAGE EXAMPLES
// ============================================

// Basic usage:
// toast.success('Livre créé avec succès');

// With description:
// toast.success('Livre créé', 'Le livre "Mon Titre" a été ajouté');

// Promise:
// toast.promise(saveBook(data), {
//   loading: 'Sauvegarde en cours...',
//   success: 'Livre sauvegardé !',
//   error: 'Erreur lors de la sauvegarde',
// });

// Custom duration:
// toast.success('Action rapide', { duration: 2000 });
