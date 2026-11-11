// C-библиотеки расширения (Vendor/*.xcframework):
//   libXray.h  — ядро Xray, единственный вход CGoInvoke(JSON)
//   hev-socks5-tunnel.h — hev-socks5-tunnel: tun → socks5
#include "libXray.h"
#include "hev-socks5-tunnel.h"

// Поиск дескриптора utun: в iOS SDK нет <sys/kern_control.h>, структуры объявлены здесь
// (как в Tun2SocksKit, MIT).
#include <sys/types.h>
#include <sys/socket.h>
#ifndef CTLIOCGINFO
#define CTLIOCGINFO 0xc0644e03UL
struct ctl_info {
    u_int32_t ctl_id;
    char ctl_name[96];
};
struct sockaddr_ctl {
    u_char sc_len;
    u_char sc_family;
    u_int16_t ss_sysaddr;
    u_int32_t sc_id;
    u_int32_t sc_unit;
    u_int32_t sc_reserved[5];
};
#endif
