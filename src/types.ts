export interface PauboxCredentials {
  apiUsername: string;
  apiKey: string;
}

export interface SendEmailOptions {
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentOption[];
}

export interface AttachmentOption {
  fileName: string;
  contentType: string;
  content: string;
}

export interface PauboxMessagePayload {
  data: {
    message: {
      recipients: string[];
      headers: {
        subject: string;
        from: string;
        'reply-to': string;
      };
      content: {
        'text/plain'?: string;
        'text/html'?: string;
      };
      attachments?: AttachmentOption[];
    };
  };
}

export interface SendEmailResponse {
  sourceTrackingId: string;
  data: string;
}

export interface MessageDelivery {
  recipient: string;
  status: {
    deliveryStatus: string;
    deliveryTime: string;
    openedStatus: string;
    openedTime: string;
  };
}

export interface MessageStatusResponse {
  sourceTrackingId: string;
  data: {
    message: {
      id: string;
      message_deliveries: MessageDelivery[];
    };
  };
}

export interface ConfigData {
  defaultFrom?: string;
  [key: string]: string | undefined;
}

export type OutputFormat = 'human' | 'json';

export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}
