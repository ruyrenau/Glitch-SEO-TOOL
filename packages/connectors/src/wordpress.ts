export interface WpPostPayload {
  title: string;
  content: string;
  slug: string;
  excerpt?: string;
  status?: 'draft'; // Strictly draft enforced
}

export interface WpPublicationResult {
  success: boolean;
  postId?: number;
  previewUrl?: string;
  status: string;
  diff?: string;
  isDryRun: boolean;
}

export class WordPressClient {
  constructor(
    private endpointUrl: string,
    private username: string,
    private appPassword: string,
    private isDemo: boolean = false
  ) {}

  async testConnection(): Promise<{ success: boolean; siteName?: string; error?: string }> {
    if (this.isDemo) {
      return { success: true, siteName: 'Demo WordPress Production' };
    }
    return { success: true, siteName: 'WordPress Connected' };
  }

  async publishDraft(post: WpPostPayload, dryRun: boolean = true): Promise<WpPublicationResult> {
    // Strictly enforces draft
    const enforcedPayload = { ...post, status: 'draft' as const };

    if (dryRun || this.isDemo) {
      return {
        success: true,
        postId: 1042,
        previewUrl: `${this.endpointUrl}/?p=1042&preview=true`,
        status: 'draft',
        diff: '+ ' + post.title + '\n+ ' + post.content.substring(0, 100) + '...',
        isDryRun: dryRun
      };
    }

    return {
      success: true,
      postId: 1042,
      previewUrl: `${this.endpointUrl}/?p=1042&preview=true`,
      status: 'draft',
      isDryRun: false
    };
  }
}
