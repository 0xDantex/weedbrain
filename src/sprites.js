// Hand-drawn pixel sprites for the buzzkills. One char is one
// pixel; "." is transparent. Palettes map chars to 0xRRGGBB.

export const PAL = {
  k: 0x16110f, // outline
  s: 0xe2b48f, // skin
  S: 0xb98563, // skin shade
  w: 0xf1ede4, // white
  y: 0xf2c230, // gold
  r: 0xc0322b, // red
  b: 0x2c4a9a, // police blue
  B: 0x1d3270, // blue shade
  p: 0xf08bb4, // pink
  P: 0xc9628e, // pink shade
  h: 0x6b4428, // brown hair
  d: 0x23232b, // suit
  D: 0x34343f, // suit light
  g: 0x9c9c9c, // grey hair
  c: 0x141418, // cassock
  C: 0x2a2a31, // cassock light
  o: 0xeb6c25, // orange
};

// Upper bodies, 14 wide. Legs are drawn by code so the walk cycle is shared.
export const KILL_SPRITES = [
  {
    name: "COP",
    legs: [0x1d3270, 0x16110f],
    rows: [
      "....kkkkkk....",
      "...kbbbbbbk...",
      "..kbbbbybbbk..",
      "..kkkkkkkkkkk.",
      "...kssssssk...",
      "...kskssksk...",
      "...kssssssk...",
      "...kssrrssk...",
      "....kssssk....",
      "..kkbbbbbbkk..",
      ".kbbbbbbbbbbk.",
      ".kbbybbbbbBbk.",
      ".kbbbbbbbbBbk.",
      ".ksbbbbbbbbsk.",
      ".ksbbbbbbbbsk.",
      "..kbbbbbbbbk..",
      "..kkkkykkkkk..",
      "..kBBBBBBBBk..",
    ],
  },
  {
    name: "MOM",
    legs: [0xe2b48f, 0xf08bb4],
    rows: [
      "...kpkpkpk....",
      "..khphphphk...",
      "..khhhhhhhk...",
      "..khssssshk...",
      "..kskssksk....",
      "..kssssssk....",
      "..kssrrssk.kk.",
      "...kssssk.kppk",
      "...kkppkk.kppk",
      "..kppppppkkpk.",
      ".kppwppppppk..",
      ".kppwppppPk...",
      ".kpppppppPk...",
      ".kppppppppk...",
      ".kPpppppppk...",
      "..kppppppPk...",
      "..kPppppppk...",
      "..kkkkkkkkk...",
    ],
  },
  {
    name: "FED",
    legs: [0x23232b, 0x16110f],
    rows: [
      "....kkkkkk....",
      "...kddddddk...",
      "...kdssssdk...",
      "...kkkkkkkkk..",
      "...kkksskkk...",
      "...kssssssk...",
      "...kssSSssk...",
      "....kssssk....",
      "..kkdwrwdkk...",
      ".kDddwrwdddk..",
      ".kDddwrwdddk..",
      ".kDdddrddddk..",
      ".kDdddddddk...",
      ".ksdddddddsk..",
      ".ksddddddddk..",
      "..kddddddddk..",
      "..kkkkkkkkkk..",
      "..kddddddddk..",
    ],
  },
  {
    name: "PRIEST",
    legs: [0x141418, 0x16110f],
    rows: [
      "....kkkkkk....",
      "...kggggggk...",
      "...kgssssgk...",
      "...kskssksk...",
      "...kssssssk...",
      "...kssSSssk...",
      "....kssssk....",
      "..kkcwwwwckk..",
      ".kCccwwwwccck.",
      ".kCcccyyccck..",
      ".kCccyyyyccck.",
      ".kCcccyycccck.",
      ".ksccccyccccsk",
      ".ksccccccccsk.",
      "..kccccccccck.",
      "..kCcccccccck.",
      "..kCcccccccck.",
      "..kCcccccccck.",
    ],
  },
];
