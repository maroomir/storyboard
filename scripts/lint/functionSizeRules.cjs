const functionSizeLimits = {
  'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
  complexity: ['error', 20],
};

const functionSizeExemption = {
  'max-lines-per-function': 'off',
  complexity: 'off',
};

module.exports = { functionSizeLimits, functionSizeExemption };
