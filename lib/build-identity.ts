/**
 * The build stamp. A served page must be able to say which build it is,
 * so a walk can tell "the fix is deployed" from "the fix is merged".
 */

export type Env = Record<string, string | undefined>

export type BuildIdentity = {
  tool: 'drm-standee'
  version: 'v2'
  deploy: string
  BUILD_SHA12: string
}

export function buildIdentity(env: Env = {}): BuildIdentity {
  const sha = (env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? '').trim()
  const deploy = (env.VERCEL_ENV ?? '').trim()
  return {
    tool: 'drm-standee',
    version: 'v2',
    deploy: deploy || 'local',
    BUILD_SHA12: sha ? sha.slice(0, 12) : 'unknown',
  }
}

export function buildStampText(build: BuildIdentity): string {
  return `${build.tool} ${build.version} · ${build.deploy} · ${build.BUILD_SHA12}`
}
