export interface ExecutionResult {
  success: boolean;
  execution?: {
    output: string;
    error: string | null;
    execution_time: number;
    resource_stats: {
      memory_used_mb: number;
      memory_limit_mb: number;
    };
  };
  analysis?: {
    syntax: string;
    ast_features: any;
    complexity: string;
    static_issues: any;
    runtime_characteristics: any;
    code_quality_score: number;
  };
  error?: string;
  error_line?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface UserMastery {
  topic: string;
  score: number;
  attempts: number;
}

export interface LearningNode {
  id: string;
  title: string;
  status: 'locked' | 'available' | 'completed' | 'current';
  qValue: number;
  description: string;
}

export enum TabView {
  EDITOR = 'EDITOR',
  DASHBOARD = 'DASHBOARD',
  PATH = 'PATH',
  PROBLEMS = 'PROBLEMS',
  AUTH = 'AUTH'
}


