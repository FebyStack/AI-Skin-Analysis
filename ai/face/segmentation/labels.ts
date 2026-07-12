// CelebAMask-HQ class ids from jonathandinu/face-parsing (SegFormer-B5).
export const PARSE = {
    background: 0,
    skin: 1,
    nose: 2,
    eye_g: 3,
    l_eye: 4,
    r_eye: 5,
    l_brow: 6,
    r_brow: 7,
    l_ear: 8,
    r_ear: 9,
    mouth: 10,
    u_lip: 11,
    l_lip: 12,
    hair: 13,
    hat: 14,
    ear_r: 15,
    neck_l: 16,
    neck: 17,
    cloth: 18,
} as const;

export const NUM_PARSE_CLASSES = 19;

/** Never sample these inside a skin-analysis zone. */
export const PARSE_EXCLUDE = new Set<number>([
    PARSE.background,
    PARSE.mouth,
    PARSE.u_lip,
    PARSE.l_lip,
    PARSE.hair,
    PARSE.hat,
    PARSE.cloth,
    PARSE.eye_g,
]);
