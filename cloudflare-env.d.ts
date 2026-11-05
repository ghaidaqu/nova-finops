declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    // Secrets set in the host (ChatGPT Sites) or .dev.vars locally; never in source.
    NOVA_SECRET_KEY?: string;
    NOVA_ADMIN_EMAILS?: string;
    SALLA_CLIENT_ID?: string;
    SALLA_CLIENT_SECRET?: string;
    ZID_CLIENT_ID?: string;
    ZID_CLIENT_SECRET?: string;
    FOODICS_CLIENT_ID?: string;
    FOODICS_CLIENT_SECRET?: string;
  }
}
