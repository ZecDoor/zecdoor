export const appName = 'ZecDoor';
/** Routes inside this Next app; basePath adds /docs in front of all of them. */
export const docsRoute = '/';

/**
 * The public repository, set at build time (SOURCE_URL in scripts/build-site.sh) once the GitHub
 * organisation exists. Until then no page links to it: repository links in the docs show
 * SOURCE_PENDING instead, and the GitHub and "edit" links are left out.
 */
export const SOURCE_URL: string | null = process.env.NEXT_PUBLIC_SOURCE_URL || null;
export const SOURCE_PENDING = 'Code goes public under the MIT licence at launch';
/** How the docs content writes links into our own repository. */
export const REPO_PREFIX = 'https://github.com/ZecDoor/zecdoor';

export const gitConfig = {
  user: 'ZecDoor',
  repo: 'zecdoor',
  branch: 'main',
  contentPath: 'apps/docs/content/docs',
};
