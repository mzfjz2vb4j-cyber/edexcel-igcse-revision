import type {NextConfig} from 'next';
// Type checking runs after webpack in `pnpm build`. This avoids concurrent
// compiler heaps in constrained CI while still failing the build on type errors,
// including Next's generated route types. Do not deploy with `next build` alone.
const config:NextConfig={poweredByHeader:false,reactStrictMode:true,experimental:{cpus:1,webpackBuildWorker:false},typescript:{ignoreBuildErrors:true},async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]}]}};export default config;
