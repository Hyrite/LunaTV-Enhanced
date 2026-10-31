const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // if using TypeScript with a baseUrl set to the root directory then you need the below for alias' to work
  moduleDirectories: ['node_modules', '<rootDir>/'],

  testEnvironment: 'jest-environment-jsdom',

  /**
   * Absolute imports and Module Path Aliases
   */
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/public/$1',
    '^.+\\.(svg)$': '<rootDir>/src/__mocks__/svg.tsx',
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
// next/jest 默认不转换 node_modules（只放行 geist 和 Next 自身的几个目录）；
// nanoid 5 只提供 ES Module，把它加进放行列表，让 Jest 转换它（兼容 pnpm 的 .pnpm 目录结构）
const ESM_PACKAGES = ['nanoid'];
module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  config.transformIgnorePatterns = (config.transformIgnorePatterns || []).map((pattern) =>
    pattern.split('(geist|').join(`(geist|${ESM_PACKAGES.join('|')}|`),
  );
  return config;
};
