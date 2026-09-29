export type ValidationErrors = Partial<{
  repo: string;
  domain: string;
  ftpServer: string;
  ftpLogin: string;
  ftpPassword: string;
  serverDir: string;
  port: string;
  buildEnv: string;
}>;

export type PreviewContent = {
  name: string;
  content: string;
};
