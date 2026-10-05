import type { ComponentProps, FC } from 'react';
import { REPO_PREFIX, SOURCE_PENDING, SOURCE_URL } from '@/lib/shared';

type A = FC<ComponentProps<'a'>>;

/**
 * Links into our own repository point at SOURCE_URL once it is set. Until then they are not links:
 * the text stays, followed by SOURCE_PENDING, so no page sends a reader to a 404.
 */
export function repoLinks(Inner: A): A {
  return function RepoLink(props) {
    const href = props.href ?? '';
    if (!href.startsWith(REPO_PREFIX)) return <Inner {...props} />;
    if (SOURCE_URL) return <Inner {...props} href={SOURCE_URL + href.slice(REPO_PREFIX.length)} />;
    return (
      <span>
        {props.children} <span className="text-fd-muted-foreground">({SOURCE_PENDING.toLowerCase()})</span>
      </span>
    );
  };
}
