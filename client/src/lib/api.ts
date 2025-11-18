import { apiRequest } from "./queryClient";

// Re-export the existing apiRequest function
export { apiRequest };

// Additional API utility functions
export async function uploadFile(endpoint: string, file: File, additionalData?: Record<string, any>) {
  const formData = new FormData();
  formData.append('file', file);
  
  if (additionalData) {
    Object.entries(additionalData).forEach(([key, value]) => {
      formData.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }

  return response;
}

export async function downloadFile(endpoint: string, filename?: string) {
  const response = await fetch(endpoint, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  const blob = await response.blob();
  
  // Create download link
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export async function apiCall<T = any>(
  method: string,
  endpoint: string,
  data?: any
): Promise<ApiResponse<T>> {
  try {
    const response = await apiRequest(method, endpoint, data);
    const result = await response.json();
    
    return {
      ok: true,
      data: result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
