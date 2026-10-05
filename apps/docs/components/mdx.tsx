import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import type { MDXComponents } from 'mdx/types';
import { SOURCE_PENDING, SOURCE_URL } from '@/lib/shared';

/** Where to report a problem: security.txt once it is served (with the public code), until then said plainly. */
function SecurityContact() {
  return SOURCE_URL ? (
    <p>
      Please report privately first: open an issue at{' '}
      <a href={`${SOURCE_URL}/issues`}>{SOURCE_URL.replace('https://', '')}/issues</a> asking for a private channel, without
      any details, and we will reply there. Policy: <a href={`${SOURCE_URL}/blob/main/SECURITY.md`}>SECURITY.md</a>; contact
      also in <a href="/.well-known/security.txt">security.txt</a>.
    </p>
  ) : (
    <p>The security contact is published together with the code. {SOURCE_PENDING}.</p>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Step,
    Steps,
    SecurityContact,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
