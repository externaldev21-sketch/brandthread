/**
 * AI Assistant — redirects to the canonical AI Brain chat screen.
 *
 * ai-brain.tsx is the single source of truth for the AI chat UI.
 * This file exists only for backward compatibility with any route
 * that navigates to /ai-assistant. It immediately redirects so there
 * is no separate state or duplicate implementation.
 */
import { Redirect } from 'expo-router';

export default function AIAssistantScreen() {
  return <Redirect href="/ai-brain" />;
}
