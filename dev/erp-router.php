<?php

/**
 * DEVELOPMENT ONLY. Marks requests as HTTPS for the ERP when they arrived through
 * dev/erp-tls-proxy.mjs, which terminates real TLS on 127.0.0.1:8443 — the local equivalent
 * of `fastcgi_param HTTPS on` behind a production TLS terminator. Bound to loopback only.
 */
if (($_SERVER['REMOTE_ADDR'] ?? '') === '127.0.0.1') {
    $_SERVER['HTTPS'] = 'on';
    $_SERVER['SERVER_PORT'] = '443';
}

return require getenv('ERP_ROOT').'/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php';
