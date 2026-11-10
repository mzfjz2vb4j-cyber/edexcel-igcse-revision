import type {NextConfig} from 'next';
// `pnpm build` runs tsc after Next exits, including generated route types.
// The webpack worker releases compilation memory before page collection.
const config:NextConfig={poweredByHeader:false,reactStrictMode:true,experimental:{cpus:1,webpackBuildWorker:true,webpackMemoryOptimizations:true},typescript:{ignoreBuildErrors:true},async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Frame-Options',value:'DENY'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]}]}};export default config;
