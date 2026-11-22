import {defineConfig} from 'vite';
export default defineConfig({clearScreen:false,server:{port:1420,strictPort:true,host:'127.0.0.1'},build:{target:'es2022',rolldownOptions:{onwarn(warning,warn){if(warning.code==='MODULE_LEVEL_DIRECTIVE'&&warning.message.includes('use client'))return;warn(warning);}}}});
