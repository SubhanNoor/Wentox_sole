export type ReportOrientation = 'portrait' | 'landscape';

export interface CompanyInfo {
  name: string;
  subTitle?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
}

export interface ReportMetaField {
  label: string;
  value: string | number;
}

export interface ReportConfig {
  title: string;
  subtitle?: string;
  orientation?: ReportOrientation;
  companyInfo?: CompanyInfo;
  periodFrom?: string;
  periodTo?: string;
  metadata?: ReportMetaField[];
}

export const DEFAULT_COMPANY_INFO: CompanyInfo = {
  name: 'WENTOX SOLE',
  subTitle: 'Premium Footwear Sole Manufacturers',
  address: 'Main Factory Line, Footwear Zone',
  phone: '+92 300 0000000',
  email: 'info@wentoxsole.com',
};
