// shared/validators.js - 前后端共用的字段校验规则（纯函数，无 DOM/Node 依赖）

const RULES = {
  username: {
    pattern: /^[a-zA-Z0-9_]{3,20}$/,
    message: '用户名须为 3-20 位字母、数字或下划线',
  },
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: '请输入有效的邮箱地址',
  },
  password: {
    minLen: 8,
    maxLen: 72,
    message: '密码长度须为 8-72 位',
  },
  displayName: {
    maxLen: 24,
    message: '昵称最多 24 个字符',
  },
  inviteCode: {
    pattern: /^NX-[A-Z0-9]{5}-[A-Z0-9]{5}$/,
    message: '邀请码格式不正确',
  },
};

function validate(field, value) {
  const rule = RULES[field];
  if (!rule) return null;

  if (rule.pattern && !rule.pattern.test(value)) return rule.message;
  if (rule.minLen && value.length < rule.minLen) return rule.message;
  if (rule.maxLen && value.length > rule.maxLen) return rule.message;

  return null;
}

function validateAll(fields) {
  const errors = {};
  for (const [key, value] of Object.entries(fields)) {
    const err = validate(key, value);
    if (err) errors[key] = err;
  }
  return Object.keys(errors).length ? errors : null;
}

export { RULES, validate, validateAll };
