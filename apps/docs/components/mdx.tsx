import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import type { MDXComponents } from 'mdx/types';
import { SOURCE_PENDING, SOURCE_URL } from '@/lib/shared';

/** Where to report a problem: security.txt once it is served (with the public code), until then said plainly. */
function SecurityContact() {
  return SOURCE_URL ? (
    <p>
      See <a href="/.well-known/security.txt">/.well-known/security.txt</a>. Please report privately first.
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
