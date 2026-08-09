export function buildGameInvitation(input: {
  baseUrl: string;
  roomId: string;
  roomPassword: string | null;
  inviterNickname: string;
}) {
  const roomId = input.roomId.trim().toUpperCase();
  const url = new URL(input.baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", roomId);
  const password = input.roomPassword === null ? "无密码" : input.roomPassword;
  return {
    url: url.toString(),
    text: [
      `${input.inviterNickname} 邀请你来下一盘像素五子棋`,
      `网址：${url.toString()}`,
      `房间号：${roomId}`,
      `房间密码：${password}`,
      "打开后请先登录或注册，再输入房间信息加入对战。",
    ].join("\n"),
  };
}
