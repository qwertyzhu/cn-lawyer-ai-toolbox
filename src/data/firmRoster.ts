export interface FirmMemberRosterEntry {
  name: string;
  role: string;
}

/**
 * 律所团队名录示例（仅用于开启 `VITE_AUTH_MODE=license` 团队发码模式时的一键填入参考）
 * 律所部署时可替换为本所团队名单（切勿提交个人手机号等敏感信息）。
 */
export const TIANRAN_OFFICIAL_ROSTER: FirmMemberRosterEntry[] = [
  { name: '张示范', role: '主任' },
  { name: '李示例', role: '合伙人' },
  { name: '王示例', role: '专职律师' },
  { name: '赵示例', role: '律师助理' },
];
