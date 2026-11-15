// Countdown-tile celebrations, copied from design/EventTiles.dc.html: each
// particle's inline style verbatim (position, size, colour, timing). The tile
// burst comes from the icon; the sky fills the whole screen. Regenerate from
// the design file rather than editing by hand.

export const BITS = [
"--dx: -210px; --dy: -54px; --dx2: -252px; --dy2: 84px; --r: -294deg; width: 10px; height: 10px; border-radius: 50%; background: #0b6760; animation-delay: 102ms",
"--dx: -204px; --dy: -96px; --dx2: -245px; --dy2: 20px; --r: 355deg; width: 12px; height: 18px; border-radius: 3px; background: #934606; animation-delay: 18ms",
"--dx: -214px; --dy: -124px; --dx2: -257px; --dy2: 26px; --r: -504deg; width: 14px; height: 8px; border-radius: 3px; background: #c9b6f5; animation-delay: 50ms",
"--dx: -145px; --dy: -176px; --dx2: -174px; --dy2: -25px; --r: -519deg; width: 14px; height: 8px; border-radius: 3px; background: #f5b3c8; animation-delay: 1ms",
"--dx: -81px; --dy: -135px; --dx2: -97px; --dy2: -13px; --r: -507deg; width: 12px; height: 18px; border-radius: 3px; background: #24559e; animation-delay: 3ms",
"--dx: -70px; --dy: -176px; --dx2: -84px; --dy2: -13px; --r: -465deg; width: 14px; height: 8px; border-radius: 3px; background: #f2c27a; animation-delay: 29ms",
"--dx: -48px; --dy: -204px; --dx2: -58px; --dy2: -89px; --r: 535deg; width: 14px; height: 8px; border-radius: 3px; background: #8c2a4f; animation-delay: 35ms",
"--dx: -23px; --dy: -215px; --dx2: -28px; --dy2: -60px; --r: 361deg; width: 12px; height: 18px; border-radius: 3px; background: #4a3480; animation-delay: 97ms",
"--dx: 6px; --dy: -185px; --dx2: 7px; --dy2: -39px; --r: -405deg; width: 12px; height: 18px; border-radius: 3px; background: #0b6760; animation-delay: 13ms",
"--dx: 64px; --dy: -186px; --dx2: 77px; --dy2: -22px; --r: -309deg; width: 12px; height: 18px; border-radius: 3px; background: #934606; animation-delay: 26ms",
"--dx: 78px; --dy: -135px; --dx2: 94px; --dy2: 20px; --r: 414deg; width: 10px; height: 10px; border-radius: 50%; background: #c9b6f5; animation-delay: 9ms",
"--dx: 102px; --dy: -141px; --dx2: 122px; --dy2: -14px; --r: 244deg; width: 14px; height: 8px; border-radius: 3px; background: #f5b3c8; animation-delay: 39ms",
"--dx: 181px; --dy: -194px; --dx2: 217px; --dy2: -76px; --r: -251deg; width: 12px; height: 18px; border-radius: 3px; background: #24559e; animation-delay: 1ms",
"--dx: 187px; --dy: -159px; --dx2: 224px; --dy2: -6px; --r: -429deg; width: 12px; height: 18px; border-radius: 3px; background: #f2c27a; animation-delay: 65ms",
"--dx: 209px; --dy: -114px; --dx2: 251px; --dy2: 22px; --r: 259deg; width: 12px; height: 18px; border-radius: 3px; background: #8c2a4f; animation-delay: 50ms",
"--dx: 169px; --dy: -48px; --dx2: 203px; --dy2: 117px; --r: 210deg; width: 10px; height: 10px; border-radius: 50%; background: #4a3480; animation-delay: 26ms"
];

export const BALLOONS = [
"--x0: -37px; --x1: 24px; --y1: -405px; --r: -14deg; width: 40px; height: 50px; border-radius: 50% 50% 46% 46%; background: #f5b3c8; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08); animation-delay: 0ms",
"--x0: -42px; --x1: -73px; --y1: -493px; --r: -7deg; width: 40px; height: 50px; border-radius: 50% 50% 46% 46%; background: #c9b6f5; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08); animation-delay: 140ms",
"--x0: -59px; --x1: -31px; --y1: -455px; --r: -3deg; width: 40px; height: 50px; border-radius: 50% 50% 46% 46%; background: #f2c27a; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08); animation-delay: 280ms",
"--x0: -51px; --x1: -153px; --y1: -403px; --r: -9deg; width: 40px; height: 50px; border-radius: 50% 50% 46% 46%; background: #8fd3c8; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08); animation-delay: 420ms",
"--x0: 14px; --x1: -2px; --y1: -383px; --r: 4deg; width: 40px; height: 50px; border-radius: 50% 50% 46% 46%; background: #9dbcf0; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08); animation-delay: 560ms",
"--x0: -13px; --x1: 37px; --y1: -496px; --r: -11deg; width: 40px; height: 50px; border-radius: 50% 50% 46% 46%; background: #f5b3c8; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08); animation-delay: 700ms",
"--x0: 15px; --x1: 122px; --y1: -414px; --r: 12deg; width: 40px; height: 50px; border-radius: 50% 50% 46% 46%; background: #c9b6f5; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08); animation-delay: 840ms"
];

export const FLAKES = [
"--x0: 27px; --x1: 10px; --r: 129deg; width: 26px; height: 26px; animation-delay: 636ms",
"--x0: -54px; --x1: -16px; --r: 275deg; width: 16px; height: 16px; animation-delay: 388ms",
"--x0: -89px; --x1: -49px; --r: 140deg; width: 26px; height: 26px; animation-delay: 795ms",
"--x0: 77px; --x1: 114px; --r: 197deg; width: 16px; height: 16px; animation-delay: 97ms",
"--x0: -117px; --x1: -144px; --r: 221deg; width: 16px; height: 16px; animation-delay: 522ms",
"--x0: -48px; --x1: -38px; --r: 197deg; width: 20px; height: 20px; animation-delay: 1005ms",
"--x0: -20px; --x1: 6px; --r: 274deg; width: 16px; height: 16px; animation-delay: 140ms",
"--x0: -106px; --x1: -117px; --r: 233deg; width: 20px; height: 20px; animation-delay: 151ms",
"--x0: -27px; --x1: -40px; --r: 281deg; width: 16px; height: 16px; animation-delay: 33ms",
"--x0: -135px; --x1: -141px; --r: 204deg; width: 20px; height: 20px; animation-delay: 510ms",
"--x0: -140px; --x1: -175px; --r: 162deg; width: 16px; height: 16px; animation-delay: 755ms",
"--x0: 101px; --x1: 134px; --r: 113deg; width: 16px; height: 16px; animation-delay: 741ms",
"--x0: -100px; --x1: -83px; --r: 258deg; width: 20px; height: 20px; animation-delay: 1068ms",
"--x0: 129px; --x1: 106px; --r: 98deg; width: 26px; height: 26px; animation-delay: 36ms"
];

export const RAIN = [
"left: 1163px; --sx: 58px; --h: 880px; --r: 631deg; --d: 3273ms; --dl: 127ms; width: 18px; height: 10px; border-radius: 3px; background: #0b6760",
"left: 602px; --sx: -26px; --h: 880px; --r: -672deg; --d: 3363ms; --dl: 689ms; width: 14px; height: 22px; border-radius: 3px; background: #934606",
"left: 401px; --sx: 8px; --h: 880px; --r: 833deg; --d: 3105ms; --dl: 453ms; width: 14px; height: 22px; border-radius: 3px; background: #c9b6f5",
"left: 379px; --sx: 63px; --h: 880px; --r: 855deg; --d: 2855ms; --dl: 667ms; width: 18px; height: 10px; border-radius: 3px; background: #f5b3c8",
"left: 1068px; --sx: 148px; --h: 880px; --r: -862deg; --d: 2562ms; --dl: 385ms; width: 14px; height: 22px; border-radius: 3px; background: #24559e",
"left: 371px; --sx: 20px; --h: 880px; --r: -816deg; --d: 3559ms; --dl: 299ms; width: 14px; height: 22px; border-radius: 3px; background: #f2c27a",
"left: 1148px; --sx: 36px; --h: 880px; --r: 442deg; --d: 2805ms; --dl: 387ms; width: 12px; height: 12px; border-radius: 50%; background: #8c2a4f",
"left: 655px; --sx: 154px; --h: 880px; --r: -893deg; --d: 2516ms; --dl: 331ms; width: 18px; height: 10px; border-radius: 3px; background: #4a3480",
"left: 785px; --sx: 114px; --h: 880px; --r: 381deg; --d: 2755ms; --dl: 672ms; width: 12px; height: 12px; border-radius: 50%; background: #3ee0d0",
"left: 1571px; --sx: 38px; --h: 880px; --r: 817deg; --d: 2634ms; --dl: 172ms; width: 14px; height: 22px; border-radius: 3px; background: #0b6760",
"left: 1423px; --sx: -123px; --h: 880px; --r: -571deg; --d: 2886ms; --dl: 690ms; width: 18px; height: 10px; border-radius: 3px; background: #934606",
"left: 901px; --sx: 154px; --h: 880px; --r: 522deg; --d: 2816ms; --dl: 79ms; width: 14px; height: 22px; border-radius: 3px; background: #c9b6f5",
"left: 927px; --sx: 131px; --h: 880px; --r: -862deg; --d: 3232ms; --dl: 627ms; width: 14px; height: 22px; border-radius: 3px; background: #f5b3c8",
"left: 91px; --sx: 87px; --h: 880px; --r: 562deg; --d: 2682ms; --dl: 666ms; width: 14px; height: 22px; border-radius: 3px; background: #24559e",
"left: 1757px; --sx: -131px; --h: 880px; --r: 491deg; --d: 2803ms; --dl: 317ms; width: 14px; height: 22px; border-radius: 3px; background: #f2c27a",
"left: 1611px; --sx: 160px; --h: 880px; --r: -664deg; --d: 2762ms; --dl: 421ms; width: 18px; height: 10px; border-radius: 3px; background: #8c2a4f",
"left: 751px; --sx: 42px; --h: 880px; --r: -625deg; --d: 3544ms; --dl: 552ms; width: 18px; height: 10px; border-radius: 3px; background: #4a3480",
"left: 945px; --sx: -4px; --h: 880px; --r: -804deg; --d: 2855ms; --dl: 52ms; width: 12px; height: 12px; border-radius: 50%; background: #3ee0d0",
"left: 284px; --sx: 87px; --h: 880px; --r: 439deg; --d: 2994ms; --dl: 662ms; width: 12px; height: 12px; border-radius: 50%; background: #0b6760",
"left: 1491px; --sx: 19px; --h: 880px; --r: 452deg; --d: 2475ms; --dl: 319ms; width: 18px; height: 10px; border-radius: 3px; background: #934606",
"left: 482px; --sx: -26px; --h: 880px; --r: 458deg; --d: 3152ms; --dl: 9ms; width: 12px; height: 12px; border-radius: 50%; background: #c9b6f5",
"left: 1755px; --sx: 13px; --h: 880px; --r: 376deg; --d: 2691ms; --dl: 319ms; width: 14px; height: 22px; border-radius: 3px; background: #f5b3c8",
"left: 731px; --sx: 67px; --h: 880px; --r: 465deg; --d: 2695ms; --dl: 359ms; width: 14px; height: 22px; border-radius: 3px; background: #24559e",
"left: 142px; --sx: -87px; --h: 880px; --r: -492deg; --d: 3339ms; --dl: 655ms; width: 14px; height: 22px; border-radius: 3px; background: #f2c27a",
"left: 1249px; --sx: 100px; --h: 880px; --r: -625deg; --d: 3314ms; --dl: 578ms; width: 12px; height: 12px; border-radius: 50%; background: #8c2a4f",
"left: 1174px; --sx: -87px; --h: 880px; --r: -729deg; --d: 2553ms; --dl: 444ms; width: 14px; height: 22px; border-radius: 3px; background: #4a3480",
"left: 184px; --sx: 31px; --h: 880px; --r: 433deg; --d: 2839ms; --dl: 373ms; width: 12px; height: 12px; border-radius: 50%; background: #3ee0d0",
"left: 491px; --sx: 96px; --h: 880px; --r: 692deg; --d: 2768ms; --dl: 495ms; width: 18px; height: 10px; border-radius: 3px; background: #0b6760",
"left: 601px; --sx: -3px; --h: 880px; --r: -805deg; --d: 2709ms; --dl: 440ms; width: 14px; height: 22px; border-radius: 3px; background: #934606",
"left: 1263px; --sx: -149px; --h: 880px; --r: 635deg; --d: 2798ms; --dl: 399ms; width: 12px; height: 12px; border-radius: 50%; background: #c9b6f5",
"left: 1283px; --sx: 116px; --h: 880px; --r: 522deg; --d: 2877ms; --dl: 88ms; width: 12px; height: 12px; border-radius: 50%; background: #f5b3c8",
"left: 1655px; --sx: 70px; --h: 880px; --r: 825deg; --d: 2654ms; --dl: 578ms; width: 12px; height: 12px; border-radius: 50%; background: #24559e",
"left: 1754px; --sx: 157px; --h: 880px; --r: -635deg; --d: 2817ms; --dl: 198ms; width: 12px; height: 12px; border-radius: 50%; background: #f2c27a",
"left: 1396px; --sx: -110px; --h: 880px; --r: -597deg; --d: 2407ms; --dl: 656ms; width: 18px; height: 10px; border-radius: 3px; background: #8c2a4f",
"left: 1286px; --sx: -139px; --h: 880px; --r: 460deg; --d: 3528ms; --dl: 338ms; width: 12px; height: 12px; border-radius: 50%; background: #4a3480",
"left: 1104px; --sx: 153px; --h: 880px; --r: -580deg; --d: 3014ms; --dl: 621ms; width: 18px; height: 10px; border-radius: 3px; background: #3ee0d0",
"left: 1653px; --sx: -159px; --h: 880px; --r: 826deg; --d: 2669ms; --dl: 447ms; width: 12px; height: 12px; border-radius: 50%; background: #0b6760",
"left: 77px; --sx: 103px; --h: 880px; --r: 560deg; --d: 3306ms; --dl: 137ms; width: 14px; height: 22px; border-radius: 3px; background: #934606"
];

export const UP = [
"left: 603px; --sx: 113px; --h: -1020px; --r: -8deg; --d: 3505ms; --dl: 143ms; width: 48px; height: 60px; border-radius: 50% 50% 46% 46%; background: #f5b3c8; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 346px; --sx: -25px; --h: -1020px; --r: 11deg; --d: 3377ms; --dl: 578ms; width: 56px; height: 70px; border-radius: 50% 50% 46% 46%; background: #c9b6f5; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 836px; --sx: 5px; --h: -1020px; --r: -12deg; --d: 4142ms; --dl: 125ms; width: 64px; height: 80px; border-radius: 50% 50% 46% 46%; background: #f2c27a; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 1783px; --sx: -15px; --h: -1020px; --r: 6deg; --d: 3170ms; --dl: 457ms; width: 48px; height: 60px; border-radius: 50% 50% 46% 46%; background: #8fd3c8; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 260px; --sx: -79px; --h: -1020px; --r: -1deg; --d: 3933ms; --dl: 234ms; width: 56px; height: 70px; border-radius: 50% 50% 46% 46%; background: #9dbcf0; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 1065px; --sx: 79px; --h: -1020px; --r: 6deg; --d: 4005ms; --dl: 183ms; width: 64px; height: 80px; border-radius: 50% 50% 46% 46%; background: #f5b3c8; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 285px; --sx: -110px; --h: -1020px; --r: 6deg; --d: 3090ms; --dl: 392ms; width: 56px; height: 70px; border-radius: 50% 50% 46% 46%; background: #c9b6f5; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 1334px; --sx: 15px; --h: -1020px; --r: -8deg; --d: 3018ms; --dl: 674ms; width: 48px; height: 60px; border-radius: 50% 50% 46% 46%; background: #f2c27a; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 1665px; --sx: -46px; --h: -1020px; --r: 10deg; --d: 3552ms; --dl: 296ms; width: 48px; height: 60px; border-radius: 50% 50% 46% 46%; background: #8fd3c8; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 718px; --sx: 18px; --h: -1020px; --r: 11deg; --d: 3296ms; --dl: 717ms; width: 64px; height: 80px; border-radius: 50% 50% 46% 46%; background: #9dbcf0; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 541px; --sx: -50px; --h: -1020px; --r: -2deg; --d: 3799ms; --dl: 738ms; width: 64px; height: 80px; border-radius: 50% 50% 46% 46%; background: #f5b3c8; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 1110px; --sx: -25px; --h: -1020px; --r: -12deg; --d: 3848ms; --dl: 478ms; width: 48px; height: 60px; border-radius: 50% 50% 46% 46%; background: #c9b6f5; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 800px; --sx: 33px; --h: -1020px; --r: 4deg; --d: 3605ms; --dl: 112ms; width: 48px; height: 60px; border-radius: 50% 50% 46% 46%; background: #f2c27a; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)",
"left: 704px; --sx: -111px; --h: -1020px; --r: 4deg; --d: 3928ms; --dl: 478ms; width: 56px; height: 70px; border-radius: 50% 50% 46% 46%; background: #8fd3c8; box-shadow: inset -8px -10px 0 rgba(0,0,0,0.08)"
];

export const SNOW = [
"left: 833px; --sx: -24px; --h: 840px; --r: 140deg; --d: 3667ms; --dl: 243ms; width: 30px; height: 30px",
"left: 30px; --sx: -48px; --h: 840px; --r: 327deg; --d: 3674ms; --dl: 33ms; width: 18px; height: 18px",
"left: 1477px; --sx: 36px; --h: 840px; --r: 287deg; --d: 4201ms; --dl: 969ms; width: 36px; height: 36px",
"left: 827px; --sx: 26px; --h: 840px; --r: 223deg; --d: 4445ms; --dl: 441ms; width: 30px; height: 30px",
"left: 314px; --sx: 78px; --h: 840px; --r: 147deg; --d: 4180ms; --dl: 204ms; width: 24px; height: 24px",
"left: 1277px; --sx: -17px; --h: 840px; --r: 247deg; --d: 3962ms; --dl: 249ms; width: 18px; height: 18px",
"left: 1472px; --sx: -59px; --h: 840px; --r: 128deg; --d: 4329ms; --dl: 73ms; width: 24px; height: 24px",
"left: 466px; --sx: 16px; --h: 840px; --r: 220deg; --d: 3619ms; --dl: 964ms; width: 36px; height: 36px",
"left: 675px; --sx: 51px; --h: 840px; --r: 294deg; --d: 4033ms; --dl: 817ms; width: 24px; height: 24px",
"left: 328px; --sx: 59px; --h: 840px; --r: 137deg; --d: 4064ms; --dl: 444ms; width: 24px; height: 24px",
"left: 31px; --sx: 58px; --h: 840px; --r: 158deg; --d: 4547ms; --dl: 105ms; width: 24px; height: 24px",
"left: 1017px; --sx: 34px; --h: 840px; --r: 143deg; --d: 3683ms; --dl: 614ms; width: 18px; height: 18px",
"left: 107px; --sx: 34px; --h: 840px; --r: 120deg; --d: 3879ms; --dl: 770ms; width: 36px; height: 36px",
"left: 1607px; --sx: -51px; --h: 840px; --r: 177deg; --d: 4217ms; --dl: 767ms; width: 24px; height: 24px",
"left: 214px; --sx: 53px; --h: 840px; --r: 337deg; --d: 3905ms; --dl: 310ms; width: 24px; height: 24px",
"left: 479px; --sx: -19px; --h: 840px; --r: 355deg; --d: 3669ms; --dl: 6ms; width: 36px; height: 36px",
"left: 587px; --sx: 45px; --h: 840px; --r: 350deg; --d: 4325ms; --dl: 621ms; width: 36px; height: 36px",
"left: 949px; --sx: 63px; --h: 840px; --r: 175deg; --d: 4292ms; --dl: 877ms; width: 36px; height: 36px",
"left: 1662px; --sx: 6px; --h: 840px; --r: 188deg; --d: 4218ms; --dl: 484ms; width: 30px; height: 30px",
"left: 1305px; --sx: 64px; --h: 840px; --r: 261deg; --d: 4105ms; --dl: 887ms; width: 30px; height: 30px",
"left: 1836px; --sx: -43px; --h: 840px; --r: 171deg; --d: 4207ms; --dl: 343ms; width: 18px; height: 18px",
"left: 1704px; --sx: 5px; --h: 840px; --r: 198deg; --d: 3761ms; --dl: 414ms; width: 18px; height: 18px",
"left: 1075px; --sx: 59px; --h: 840px; --r: 150deg; --d: 3691ms; --dl: 939ms; width: 30px; height: 30px",
"left: 1589px; --sx: -20px; --h: 840px; --r: 282deg; --d: 3897ms; --dl: 506ms; width: 36px; height: 36px",
"left: 775px; --sx: 78px; --h: 840px; --r: 326deg; --d: 4548ms; --dl: 602ms; width: 36px; height: 36px",
"left: 381px; --sx: -58px; --h: 840px; --r: 167deg; --d: 4441ms; --dl: 388ms; width: 18px; height: 18px",
"left: 1524px; --sx: 19px; --h: 840px; --r: 167deg; --d: 3685ms; --dl: 999ms; width: 18px; height: 18px",
"left: 714px; --sx: 75px; --h: 840px; --r: 229deg; --d: 4444ms; --dl: 587ms; width: 36px; height: 36px",
"left: 371px; --sx: 37px; --h: 840px; --r: 134deg; --d: 4407ms; --dl: 127ms; width: 36px; height: 36px",
"left: 1096px; --sx: -3px; --h: 840px; --r: 143deg; --d: 4491ms; --dl: 903ms; width: 30px; height: 30px",
"left: 1704px; --sx: -24px; --h: 840px; --r: 208deg; --d: 4560ms; --dl: 351ms; width: 36px; height: 36px",
"left: 505px; --sx: -68px; --h: 840px; --r: 331deg; --d: 3787ms; --dl: 55ms; width: 18px; height: 18px",
"left: 402px; --sx: 37px; --h: 840px; --r: 277deg; --d: 3963ms; --dl: 72ms; width: 18px; height: 18px",
"left: 526px; --sx: -12px; --h: 840px; --r: 298deg; --d: 4318ms; --dl: 879ms; width: 18px; height: 18px"
];

export const FLAKE_SVG = "<svg width=\"100%\" height=\"100%\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" aria-hidden=\"true\"><path d=\"M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9\"></path></svg>";

/** Icons drawn for the tile (the gift's lid and the cake's flame are .wb-lid, so they move). */
export const TILE_ICONS = {
  gift: '<rect x="4" y="10" width="16" height="10" rx="1.5"></rect><path d="M12 10v10"></path><g class="wb-lid"><path d="M3 7h18v3H3zM12 7v3M12 7c-1.5-3.5-5.5-3-4.5 0M12 7c1.5-3.5 5.5-3 4.5 0"></path></g>',
  cake: "<path d=\"M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16.5c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0M12 12V8.5\"></path><path class=\"wb-lid\" d=\"M12 6.5c.9-.9.9-2 0-3-.9 1-.9 2.1 0 3z\"></path>",
  snow: "<path d=\"M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8M9.5 4l2.5 1.7L14.5 4M9.5 20l2.5-1.7 2.5 1.7\"></path>",
};
