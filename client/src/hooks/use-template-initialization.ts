import { useEffect } from 'react';
import { defaultTemplates } from '@/data/default-templates';

/**
 * Hook to initialize default templates in localStorage on app startup
 * This ensures built-in templates like "LIGHT" are available across all deployments
 */
export function useTemplateInitialization() {
  useEffect(() => {
    const initializeTemplates = () => {
      try {
        // Get existing templates from localStorage
        const existingData = localStorage.getItem('templateConfigVersions');
        let existingTemplates = existingData ? JSON.parse(existingData) : [];

        // Check which default templates are missing
        const templatesAdded: string[] = [];
        
        for (const defaultTemplate of defaultTemplates) {
          // Check if this template already exists (by name)
          const exists = existingTemplates.some(
            (t: any) => t.name === defaultTemplate.name && t.paperSize === defaultTemplate.paperSize
          );
          
          if (!exists) {
            existingTemplates.push(defaultTemplate);
            templatesAdded.push(defaultTemplate.name);
          }
        }

        // Save back to localStorage if we added any templates
        if (templatesAdded.length > 0) {
          localStorage.setItem('templateConfigVersions', JSON.stringify(existingTemplates));
          console.log(`[TemplateInit] Added default templates: ${templatesAdded.join(', ')}`);
        }
      } catch (error) {
        console.error('[TemplateInit] Failed to initialize default templates:', error);
      }
    };

    initializeTemplates();
  }, []); // Run once on mount
}
