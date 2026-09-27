/** A single conversation turn handed to the model. */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
