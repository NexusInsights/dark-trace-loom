import { writeToStream } from 'mailauth/lib/tools';
import { DkimVerifier } from './dkim-verifier.mjs';
const dkimVerify = async (input, options) => {
    let dkimVerifier = new DkimVerifier(options);
    await writeToStream(dkimVerifier, input);
    const result = {
        //headers: dkimVerifier.headers,
        headerFrom: dkimVerifier.headerFrom,
        fromFields: dkimVerifier.fromFields,
        fromSyntax: dkimVerifier.fromSyntax,
        envelopeFrom: dkimVerifier.envelopeFrom,
        // finalChunk() has added `info` to every result, and removed the comments that are false
        results: dkimVerifier.results
    };
    if (dkimVerifier.headers) {
        Object.defineProperty(result, 'headers', {
            enumerable: false,
            configurable: false,
            writable: false,
            value: dkimVerifier.headers
        });
    }
    if (dkimVerifier.arc) {
        Object.defineProperty(result, 'arc', {
            enumerable: false,
            configurable: false,
            writable: false,
            value: dkimVerifier.arc
        });
    }
    if (dkimVerifier.seal) {
        Object.defineProperty(result, 'seal', {
            enumerable: false,
            configurable: false,
            writable: false,
            value: dkimVerifier.seal
        });
    }
    return result;
};
export { dkimVerify };
