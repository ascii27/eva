// Eva's canonical Kokoro voice. af_heart is the flagship American-English
// female voice (the best-graded of Kokoro's baked-in speakers); the constant
// bundles the standard English model, the voice embedding, and the en-us
// phonemizer sources. Swapping the constant here is the whole voice change.
//
// Importing react-native-executorch executes its native JSI install — only
// require this module after kokoro.ts's availability probe (never statically).
import { KOKORO_AMERICAN_ENGLISH_FEMALE_HEART } from 'react-native-executorch';

export const EVA_TTS_CONFIG = KOKORO_AMERICAN_ENGLISH_FEMALE_HEART;
