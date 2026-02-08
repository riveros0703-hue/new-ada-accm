
export type CallStatus = 'BUSY' | 'ANSWERED' | 'UNANSWERED';
export type ReportStatus = 'UNDECIDED' | 'CALLBACK' | 'NOT INTERESTED' | 'DOCUMENTS SENT';
export type TextInboundStatus = 'YES' | 'NO';

export interface CallLog {
  id: string;
  number: string;
  duration: string; // e.g. "02:15"
  status: CallStatus;
  timestamp: Date;
  qualified?: boolean;
  reportStatus?: ReportStatus;
  textInbound?: TextInboundStatus;
  textOutbound?: boolean;
  series?: string;
}

export interface AppState {
  agentName: string;
  branchName: string;
  baseNumber: string;
  last4: string;
  attempts: number;
  isShuffle: boolean;
  interval: number;
  autoSmsEnabled: boolean;
  autoSmsAnsweredEnabled: boolean;
  adminPhone: string;
  isSystemActive: boolean;
  isDialerActive: boolean;
  callLogs: CallLog[];
  // optional admin settings
  series?: string;
  googleSheetId?: string;
  // SMS templates
  smsTemplateAnswered?: string;
  smsTemplateUnanswered?: string;
  // internal state
  isCallActive?: boolean;
}

export type ModalType = 'EDIT_BASE' | 'TAG_CALL' | 'SEND_SMS' | 'EDIT_SMS_TEMPLATE' | 'UPDATING' | null;
export type ViewType = 'dialer' | 'history';
