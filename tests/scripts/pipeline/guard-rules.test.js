// guard-rules.mjs 规则表测试（P2.1-3 组件测试 + P2.1-5 绕过路径回归）
import { describe, it, expect } from "vitest";
import { L0_RULES, L1_RULES, matchRules, isRedFilePath, bashWritesRedFile } from "../../../scripts/pipeline/guard-rules.mjs";

describe("guard-rules L0 危险命令拦截", () => {
  it.each([
    ["rm -rf target", true],
    ["rm -fr target", true],
    ["rm -r -f target", true],
    ["rm -f target", true],
    ["rm --recursive --force target", true],
    ["rm target.txt", false], // 无 force, 普通删除不拦
    ["ls -la", false],
  ])("rm 变体 %s → 拦截=%s", (cmd, blocked) => {
    expect(matchRules(cmd, L0_RULES)?.name === "rm-force").toBe(blocked);
  });

  it("git reset --hard 拦截", () => {
    expect(matchRules("git reset --hard HEAD~1", L0_RULES)?.name).toBe("git-reset-hard");
    expect(matchRules("git -C rewrite reset --hard HEAD", L0_RULES)?.name).toBe("git-reset-hard");
    expect(matchRules("git reset HEAD", L0_RULES)).toBeNull(); // 软重置不拦
  });

  it("git push 拦截 (含 -C 变体)", () => {
    expect(matchRules("git push origin main", L0_RULES)?.name).toBe("git-push");
    expect(matchRules("git -C subdir push origin main", L0_RULES)?.name).toBe("git-push");
  });

  it("rm 大小写变体拦截", () => {
    expect(matchRules("rm -fR target", L0_RULES)?.name).toBe("rm-force");
    expect(matchRules("rm -RF target", L0_RULES)?.name).toBe("rm-force");
  });

  it("非 rm 删除手段拦截", () => {
    expect(matchRules("find . -type f -delete", L0_RULES)?.name).toBe("find-delete");
    expect(matchRules("python -c 'import shutil; shutil.rmtree(\"/\")'", L0_RULES)?.name).toBe("py-rmtree");
  });

  it("npx cloudbase 部署拦截", () => {
    expect(matchRules("npx @cloudbase/cli functions:deploy", L0_RULES)?.name).toBe("deploy-prod");
  });

  it("数据库写拦截", () => {
    expect(matchRules("tcb db delete --collection orders", L0_RULES)?.name).toBe("db-write");
    expect(matchRules("mongo --eval 'db.users.drop()'", L0_RULES)?.name).toBe("db-write");
    expect(matchRules("cat data.json", L0_RULES)).toBeNull();
  });

  it("部署/上传拦截", () => {
    expect(matchRules("tcb functions:deploy adminApi", L0_RULES)?.name).toBe("deploy-prod");
    expect(matchRules("node scripts/deploy-fns.mjs", L0_RULES)?.name).toBe("deploy-prod");
  });

  it("发布关键词拦截", () => {
    expect(matchRules("npm run release", L0_RULES)?.name).toBe("publish");
    expect(matchRules("tcb framework release", L0_RULES)?.name).toBe("publish");
  });
});

describe("guard-rules L1 审计", () => {
  it("npm install 命中 L1", () => {
    expect(matchRules("npm install lodash", L1_RULES)?.name).toBe("npm-install");
  });
  it("git rebase 命中 L1", () => {
    expect(matchRules("git rebase main", L1_RULES)?.name).toBe("git-rewrite");
  });
});

describe("guard-rules red 文件路径", () => {
  it("orders 路径命中", () => {
    expect(isRedFilePath("rewrite/cloud/src/functions/app/actions/orders.ts")).toBe(true);
    expect(isRedFilePath("rewrite/cloud/src/kit/wxpay.ts")).toBe(true);
  });
  it("子串误报消除: gateway 不命中 gate", () => {
    expect(isRedFilePath("rewrite/cloud/src/kit/gateway.ts")).toBe(false);
    expect(isRedFilePath("rewrite/cloud/src/kit/transitional.ts")).toBe(false);
    expect(isRedFilePath("rewrite/cloud/src/kit/gate.test.ts")).toBe(true); // 同名测试文件仍命中
  });
  it("非 red 路径不命中", () => {
    expect(isRedFilePath("rewrite/cloud/src/functions/app/actions/identity.ts")).toBe(false);
    expect(isRedFilePath("scripts/pipeline/route.mjs")).toBe(false);
  });
  it("绝对路径命中 red", () => {
    expect(isRedFilePath("/Users/sparrow/luckyducky-fable/rewrite/cloud/src/kit/wxpay.ts")).toBe(true);
  });
});

describe("guard-rules bash 重定向写 red 文件", () => {
  it("重定向到 red 路径拦截", () => {
    expect(bashWritesRedFile("echo 'x' > rewrite/cloud/src/kit/wxpay.ts")).toBe(true);
    expect(bashWritesRedFile("cat a b >> rewrite/cloud/src/functions/app/actions/orders.ts")).toBe(true);
  });
  it("非 red 重定向不拦截", () => {
    expect(bashWritesRedFile("echo x > /tmp/foo.txt")).toBe(false);
    expect(bashWritesRedFile("ls -la")).toBe(false);
  });
});
