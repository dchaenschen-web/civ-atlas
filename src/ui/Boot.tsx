/**
 * 打开网页:先下载、先放出来的只有这一小份,主程序(App.tsx 和它用到的地图、推演、编辑地形、助手、导出……)单独一个文件。
 * 这一小份还没下好时先是页面里的加载画面(网站图标、名字、进度条;scripts/lib/loadScreen.ts),下面挂上了它就淡出。
 *
 *   就停在我的世界(homeStart.ts 的 plainHome)  先放首页(HomeShell.tsx),加载画面淡出;首页要的下好以后在后台下载主程序,
 *                                               再顺带下好新建弹窗的图、生成世界的线程。在首页点了要离开这一页的事,
 *                                               等主程序下好(多半早就下好了)把 App 挂上、接着做那一件(没下好时在点的地方说下了多少)
 *   别的(打开某个世界、分享链接、新建……)      主程序和这一小份同时开始下载(加载画面那一段一起数着下),
 *                                               下好就挂上 App,和以前一样按网址打开;加载画面一直留到 App 挂上
 *
 * 帮手模式(?gallery-helper=1,作品墙的后台在看不见的框里打开网站):不放首页、不挂 App,主程序下好以后只听后台的消息(bootHelper)。
 *
 * 主程序没下载成功(网断了、网站刚更新过旧文件不在了):要用到它的时候重新下载一次,还不行就刷新页面;
 * 刚刷新过、不能再刷的,加载画面(还在的话)换成「重新加载」;首页上点了的不再等,顶上一条带「重新加载」的提示(HomeShell.tsx)。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { HomeShell } from './HomeShell';
import { plainHome, type HomeStart } from './homeStart';
import { prefetchWorker } from './workerUrl';
import { afterHomeLoad } from './homeLoad';
import { downloadApp, loadScreenDone, loadScreenFail } from './loadScreen';

type AppModule = typeof import('./App');

// 世界存成文件、打开文件的代码(检查脚本从这里调);用到才下载
(window as unknown as { __wfWorldFiles: () => Promise<unknown> }).__wfWorldFiles = () => import('./worldFiles');
// AI 正文存在哪(检查脚本 scripts/notes-vault-check.ts 从这里调)
(window as unknown as { __wfNotes: () => Promise<unknown> }).__wfNotes = () => import('./notesCheck');

/** 网站公告(announcement.ts):页面出来以后才下载、去读有没有公告,不占首页先下的那一份 */
const AnnouncementHost = lazy(() => import('./announcement').then((m) => ({ default: m.AnnouncementHost })));

let loading: Promise<AppModule> | null = null;
/**
 * 下载主程序(只下一次;失败了下次再叫时重来)。先由加载画面那一段数着下好(下了多少给首页上显示),
 * 再 import() 从浏览器缓存里拿;数不了的、没数成的照样 import(),由浏览器自己下
 */
function loadApp(): Promise<AppModule> {
  loading ??= downloadApp()
    .catch(() => {})
    .then(() => import('./App'))
    .catch((e: unknown) => {
      loading = null;
      throw e;
    });
  return loading;
}

const RELOAD_KEY = 'civ-atlas:boot-reload';
/**
 * 主程序下载不下来:刷新页面重来(网站更新过、旧文件不在了,刷新拿到新的)。半分钟里只刷一次,网断着时不会一直刷。
 * 返回刷没刷(不刷的时候由叫的地方给人一个「重新加载」)
 */
function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** 首页要的图最多等这么久(哪张图卡住了也不一直等着不下主程序) */
const HOME_WAIT = 10_000;

/** 打开网页时就停在我的世界(只看一次) */
const HOME = plainHome();
// 不是首页:马上要用主程序(加载画面那一段已经让它和这一份一起在下了,这里接着它下的那一份)
if (!HOME) loadApp().catch(() => {});

/**
 * 帮手模式:加载画面收起,下载主程序(和平常同一份),下好就开始听后台的消息(ui/galleryHelper.ts)。
 * 下载不下来不做别的:后台等不到"准备好了",自己会说网站还没准备好
 */
export function bootHelper(): void {
  loadScreenDone();
  loadApp().then(
    (m) => m.startGalleryHelper(),
    () => {},
  );
}

export function Boot() {
  const home = HOME;
  const [app, setApp] = useState<AppModule | null>(null);
  /** 交给 App 的那一件(undefined = 还在首页,没要离开;null = 不带要做的事,照网址打开) */
  const [start, setStart] = useState<HomeStart | null | undefined>(home ? undefined : null);
  const leaving = start !== undefined;
  /** 首页上已经点了要离开的事(后台下好主程序时就不再顺带下生成线程) */
  const leftRef = useRef(false);
  /** 页面上有东西了(首页,或者 App 挂上了):加载画面淡出 */
  const shown = home || (!!app && leaving);
  useEffect(() => {
    if (shown) loadScreenDone();
  }, [shown]);

  // 首页:首页要的图(第一次来时那颗星球)下好以后,在后台下载主程序,再下新建弹窗的两张图、生成世界的线程(一样一样来,先要用的先到)。
  // 主程序没下成功不要紧,真要用时再下(见下面)
  useEffect(() => {
    if (!home) return;
    return afterHomeLoad(() => {
      loadApp().then((m) => {
        setApp(m);
        // 新建世界弹窗按需下载(不占首页体积);首页出来后顺手把它的星球图热一下
        void import('./NewWorldDialog').then((m) => m.warmNewWorldPictures());
        // 已经要离开首页的不用:App 挂上马上就开线程
        if (!leftRef.current) prefetchWorker();
      }, () => {});
    }, HOME_WAIT);
  }, [home]);

  // 要用 App 了(不是首页的直接用;首页上要离开这一页了)、主程序还没有:下载(首页上每点一下都再试),不行就刷新页面。
  // 刷新也不行(刚刷过、浏览器不让记):加载画面还在的换成「重新加载」;首页上不再等(按钮、卡片回到原样),顶上给一条带「重新加载」的提示
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    if (start === undefined || app) return;
    let live = true;
    loadApp().then(
      (m) => live && setApp(m),
      () => {
        if (!live || reloadOnce()) return;
        loadScreenFail();
        if (!home) return;
        setStart(undefined);
        setFailed((n) => n + 1);
      },
    );
    return () => {
      live = false;
    };
  }, [start, app, home]);

  // undefined = 不走了(主程序还没下好时,新建弹窗里点了「开始」又点「取消」)
  const onLeave = useCallback((s: HomeStart | null | undefined) => {
    if (s !== undefined) leftRef.current = true;
    setStart(s);
  }, []);

  const page = app && leaving ? <app.App fromHome={start ?? undefined} /> : home ? <HomeShell onLeave={onLeave} loadFailed={failed} /> : null;
  return (
    <>
      {page}
      {/* 网站公告:页面出来以后再读、再弹(加载画面盖着时不开始倒数) */}
      {shown && (
        <Suspense fallback={null}>
          <AnnouncementHost />
        </Suspense>
      )}
    </>
  );
}
