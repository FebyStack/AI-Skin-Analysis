import { FACE_ANGLES, type AngleQuality, type FaceAngle } from "../../../shared/face";

export interface SequenceState {
    current: FaceAngle;
    index: number;               // 0..4
    captured: FaceAngle[];
    lastIssues: string[];        // from the most recent failed validation
    done: boolean;
    accept(quality: AngleQuality): SequenceState;
}

export function createSequence(index = 0, captured: FaceAngle[] = [], lastIssues: string[] = []): SequenceState {
    const done = index >= FACE_ANGLES.length;
    return {
        current: FACE_ANGLES[Math.min(index, FACE_ANGLES.length - 1)],
        index, captured, lastIssues, done,
        accept(quality: AngleQuality): SequenceState {
            if (done) return this;
            return quality.ok
                ? createSequence(index + 1, [...captured, FACE_ANGLES[index]], [])
                : createSequence(index, captured, quality.issues);
        },
    };
}

const ANGLE_INSTRUCTIONS: Record<FaceAngle, string> = {
    front: "Look straight ahead and position your face inside the frame.",
    "left-45": "Turn your head slightly to the left.",
    "right-45": "Turn your head slightly to the right.",
    "left-profile": "Turn fully to the left so we see your profile.",
    "right-profile": "Turn fully to the right so we see your profile.",
};

const ISSUE_INSTRUCTIONS: Record<string, string> = {
    "no-face": "We can't see a face — position your face inside the frame.",
    "wrong-orientation": "Adjust your head to match the requested angle.",
    "too-dark": "Find better lighting — face a window or lamp.",
    "too-bright": "Too much light — turn away from the direct light source.",
    blur: "Hold the camera steady and try again.",
    "face-too-small": "Move closer so your face fills more of the frame.",
    "low-resolution": "Camera resolution is too low — try the rear camera or another device.",
};

export function instructionFor(angle: FaceAngle, issue?: string): string {
    return (issue && ISSUE_INSTRUCTIONS[issue]) || ANGLE_INSTRUCTIONS[angle];
}