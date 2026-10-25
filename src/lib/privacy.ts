export const PRIVACY_KEY = "sb-privacy";

/** Runs in <head> before first paint so a reload never flashes real numbers while privacy mode is on. */
export const PRIVACY_INIT_SCRIPT = `try{if(localStorage.getItem("${PRIVACY_KEY}")==="on")document.documentElement.dataset.privacy="on"}catch(e){}`;
