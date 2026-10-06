export type Role = 'OWNER' | 'ADMIN' | 'SEO_MANAGER' | 'EDITOR' | 'VIEWER';

export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface IssueDefinition {
  code: string;
  category: 'INDEXABILITY' | 'CRAWLABILITY' | 'CANONICAL' | 'METADATA' | 'CONTENT' | 'PERFORMANCE' | 'STRUCTURED_DATA';
  title: string;
  description: string;
  severity: IssueSeverity;
  defaultImpact: number; // 1 to 10
  defaultEffort: number; // 1 to 10
  recommendation: string;
}

export interface PriorityScoreInput {
  impact: number;
  confidence: number;
  affectedUrlsCount: number;
  businessImportance: number;
  effort: number;
  risk: number;
}
