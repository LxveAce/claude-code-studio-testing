// Verify the new quant extractor against real HF filenames.
function extractQuantTag(fileName) {
  const base = fileName.replace(/\.gguf$/i, '');
  let m;
  // Q-quants with K_X suffix (Q4_K_M, Q3_K_XL, Q5_K_S)
  m = base.match(/[._-](Q\d_K_[A-Z]+)$/i);
  if (m) return m[1].toUpperCase();
  // Q-quants with multi-digit suffix (Q4_0, Q4_0_4_4, Q5_1)
  m = base.match(/[._-](Q\d(?:_\d+)+)$/i);
  if (m) return m[1].toUpperCase();
  // I-quants (IQ3_M, IQ4_XS, IQ4_NL, IQ1_S)
  m = base.match(/[._-](IQ\d_[A-Z]+)$/i);
  if (m) return m[1].toUpperCase();
  // Short forms _q4, _q8
  m = base.match(/[._-]q(\d)$/i);
  if (m) return `Q${m[1]}`;
  // Float quants
  m = base.match(/[._-](BF16|F16|F32)$/i);
  if (m) return m[1].toUpperCase();
  // Last-resort: Q6_K, Q2_K (Q-quant with single trailing K, no underscore-suffix)
  m = base.match(/[._-](Q\d_K)$/i);
  if (m) return m[1].toUpperCase();
  return null;
}

const tests = [
  ['vntl-llama3-8b-v2-hf-q5_k_m.gguf', 'Q5_K_M'],
  ['vntl-llama3-8b-v2-hf-q8_0.gguf', 'Q8_0'],
  ['Llama-3.2-3B-Instruct-IQ3_M.gguf', 'IQ3_M'],
  ['Llama-3.2-3B-Instruct-IQ4_XS.gguf', 'IQ4_XS'],
  ['Llama-3.2-3B-Instruct-Q3_K_L.gguf', 'Q3_K_L'],
  ['Llama-3.2-3B-Instruct-Q3_K_XL.gguf', 'Q3_K_XL'],
  ['Llama-3.2-3B-Instruct-Q4_0.gguf', 'Q4_0'],
  ['Llama-3.2-3B-Instruct-Q4_0_4_4.gguf', 'Q4_0_4_4'],
  ['Llama-3.2-3B-Instruct-Q4_K_M.gguf', 'Q4_K_M'],
  ['llama-3.2-1b-instruct-q8_0.gguf', 'Q8_0'],
  ['Meta-Llama-3-8B-Instruct-abliterated-v3_q3.gguf', 'Q3'],
  ['Meta-Llama-3-8B-Instruct-abliterated-v3_q4.gguf', 'Q4'],
  ['Meta-Llama-3-8B-Instruct-abliterated-v3_q5.gguf', 'Q5'],
  ['Meta-Llama-3-8B-Instruct-abliterated-v3_q6.gguf', 'Q6'],
  ['Meta-Llama-3-8B-Instruct-abliterated-v3_q8.gguf', 'Q8'],
  ['Meta-Llama-3-8B-Instruct-abliterated-v3.gguf', null],  // no quant
  ['model.F16.gguf', 'F16'],
  ['model-BF16.gguf', 'BF16'],
  ['model-Q2_K.gguf', 'Q2_K'],
  ['model-Q6_K.gguf', 'Q6_K'],
];

let ok = 0, fail = 0;
for (const [name, expected] of tests) {
  const got = extractQuantTag(name);
  const pass = got === expected;
  if (pass) ok++; else fail++;
  console.log(`  ${pass ? '✓' : '✗'} ${name.padEnd(60)} → ${String(got).padEnd(10)} ${pass ? '' : '(expected ' + expected + ')'}`);
}
console.log(`\n${ok}/${tests.length} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
