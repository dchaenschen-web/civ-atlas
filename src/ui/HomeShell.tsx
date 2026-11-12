/**
 * 首页(我的世界)先出来的那一份:打开网站时就停在我的世界(homeStart.ts 的 plainHome)时,主程序 App.tsx 还在后台下载,
 * 先由这里把这一页放出来。用的就是 App 在我的世界时放的那几样(同一个 MyWorlds、新建世界弹窗、账号窗、提示条……,
 * 外面同样一层 .app),看起来、点起来和 App 里的一样。
 *
 * 要离开这一页的事(打开一个世界、新建弹窗里点「开始」、打开存档文件、在一张地图上打造新文明)交给 App:
 * onLeave 把这一件交出去,Boot.tsx 等主程序下好、把 App 挂上,App 接着做(见 App 的 fromHome)。
 * 主程序还没下完时在点的地方说下了多少:「开始」变成转圈 +「准备中」、旁边一句;世界卡片上一个进度圈;
 * 打开存档文件、拖文件进来没有按钮可转圈,顶上一条提示(带「取消」)。下好了这一页就换成 App。
 * 点了「作品墙」:这里先放出作品墙那一页(不用等主程序),App 挂上以后接着放它的那一页;在这一页上点的作品同样交给 App。
 * 作品墙那一页、点开的作品、开着的新建参数作品都先写进网址、记成一步(和 App 里一样),App 照网址接着打开,
 * 下好之前刷新、复制地址、按后退也对得上。地址栏里贴了作品墙的地址(#gallery、#gallery=<编号>)和点了一样。
 * 按浏览器的后退 / 前进、地址栏里贴了分享链接(只有 # 不同,页面不刷新)也交给 App:它照这时的网址打开,和刷新一样
 * (这一页先记成我的世界那一步,贴的分享链接记成新的一步,和 App 记的一样,打开以后按后退回得到首页)。
 *
 * 和 App 一样在这里也做的:账号里的世界列表、AI 接入(开了就一直开着,App 挂上以后接着用)、页面缩放的拦截、⌘S 不弹浏览器的"存储网页"。
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MyWorlds } from './MyWorlds';
import { GalleryPage } from './Gallery';
// 新建世界弹窗按需下载:首页先不带上它(首屏体积预算)
const NewWorldDialog = lazy(() => import('./NewWorldDialog').then((m) => ({ default: m.NewWorldDialog })));
import { AccountHost, setGoHome } from './AccountDialogs';
import { SameWorldHost } from './sameWorldAsk';
import { AiSettingsHost } from './AiSettings';
import { ToastBar, clearToast, showToast } from './Toast';
import { TipLayer } from './Tips';
import { useNarrow } from './device';
import { setOpenWorkHandler, setOpenWorldHandler } from './newCivAction';
import { withFileFlow } from './worldFileLazy';
import { setStage } from './stageStore';
import { setSideHold } from './sideStore';
import { getCivShow, setCivShow } from './civView';
import { baseDark, baseLook, baseOf, fillOf, fillShow, layerOf, mapViewFromUrl, type SatLook, type Style } from './mapLayers';
import { useShortcuts } from './useShortcuts';
import { createPinchGuard, setGesturePinch, wheelSample } from './wheel';
import { startFullView } from './fullWorldView';
import { setupAi } from '../ai/setup';
import { isShareHash } from '../gen/savefile';
import { randomSeedValue, type HomeStart } from './homeStart';
import { isNavState, navAdopt, navMark, navPushEarly, navReplace, navUrl } from './nav';
import { galleryHref, galleryOfUrl } from '../account/gallery';
import { useAppPercent } from './loadScreen';
import { RulesHost } from './rules/RulesHost';
import { openRulesHash, openRulesText, setNewWorldHandler } from './rules/sheetStore';
import type { RuleSet } from '../gen/civ/ruleSet';

/** 打开存档文件、等主程序下完时顶上那条提示 */
const WAIT_TOAST = 'home-wait';
/** 主程序下载不下来、也没法自动刷新重来时那条提示 */
const FAIL_TOAST = 'home-load-failed';

/**
 * null = 不带要做的事(按后退 / 前进、贴了分享链接):App 照这时的网址打开;
 * undefined = 不走了(主程序还没下好、还停在首页时,新建弹窗里点了「开始」又点了「取消」)
 */
export type LeaveHome = (start: HomeStart | null | undefined) => void;

/** loadFailed:主程序第几次没下载成功、也没法刷新页面重来(Boot.tsx;0 = 没有) */
export function HomeShell({ onLeave, loadFailed = 0 }: { onLeave: LeaveHome; loadFailed?: number }) {
  // 和 App 一开始一样:在我的世界这一步、左边的卡片不算收起;
  // 底图和填色照网址(首页的网址里没有图层,就是默认的手绘 + 国家;App.tsx 的 readUrl 和一开始那段)
  const [view] = useState(() => {
    setStage('home');
    setSideHold(true);
    const mv = mapViewFromUrl(new URLSearchParams(location.search));
    const sat: SatLook = mv?.sat ?? 'detail';
    const b = mv ? baseLook(mv.base, sat) : null;
    const style: Style = b?.style ?? 'fantasy';
    const layer = b?.data ?? 'biomes';
    const surface = b?.look ?? sat;
    if (mv) setCivShow(mv.resources ? { ...fillShow(mv.fill), resources: true } : fillShow(mv.fill));
    return { style, layer, surface };
  });
  const narrow = useNarrow();
  const civShow = getCivShow();
  const mapBase = baseOf(view.style, view.layer, view.surface);
  const theme = baseDark(mapBase) ? 'dark' : 'light';
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  /** 新建弹窗开着没有(rules = 别人分享的规则「用它新建世界」:这个世界的规则先选好这一套) */
  const [newDlg, setNewDlg] = useState<false | { rules?: RuleSet }>(false);
  const [dropping, setDropping] = useState(false);
  /** 已经点了要离开这一页的那一件、主程序还没下好(下好了这一页就换成 App) */
  const [waiting, setWaiting] = useState<HomeStart | null>(null);
  /** 主程序下了百分之几(null = 不知道;没在等的时候不跟着变) */
  const pct = useAppPercent(!!waiting);
  const leave = useCallback(
    (s: HomeStart) => {
      clearToast(FAIL_TOAST);
      setWaiting(s);
      onLeave(s);
    },
    [onLeave],
  );
  const waitRef = useRef(waiting);
  waitRef.current = waiting;
  /** 点了「作品墙」:先放出作品墙那一页 */
  const [wallUp, setWallUp] = useState(false);
  const wallUpRef = useRef(false);
  wallUpRef.current = wallUp;
  const showWall = useCallback(() => {
    setWallUp(true);
    // 网址和浏览器的一步先记上:主程序下好以后 App 照网址接着放作品墙那一页,下好之前刷新、复制地址、按后退也对得上
    navPushEarly({ page: 'gallery' }, galleryHref(location.pathname, location.search, ''));
    leave({ kind: 'gallery' });
  }, [leave]);
  /** 在作品墙那一页上点开一个世界、地图作品:网址先换成它、记一步(和 App 里一样),交给 App 去取 */
  const openWork = useCallback(
    (id: string) => {
      navPushEarly({ page: 'gallery', id }, galleryHref(location.pathname, location.search, id));
      leave({ kind: 'work', id });
    },
    [leave],
  );
  /** 地址栏里贴了作品墙的地址(浏览器记的那一步 = 作品墙):网址换成 ?gallery 的写法,放出作品墙那一页 / 交给 App 去取那个作品 */
  const pastedWall = (id: string) => {
    if (!isNavState(history.state)) navAdopt({ page: 'gallery', ...(id ? { id } : {}) });
    navUrl(galleryHref(location.pathname, location.search, id));
    if (id) return leave({ kind: 'work', id });
    setWallUp(true);
    leave({ kind: 'gallery' });
  };
  const pastedRef = useRef(pastedWall);
  pastedRef.current = pastedWall;
  /** 不走了(新建弹窗里点了「取消」、提示条上点了「取消」):已经交出去、还没人接的那张图扔掉 */
  const stay = useCallback(() => {
    const w = waitRef.current;
    if (w?.kind === 'dialog' && w.start.picture) URL.revokeObjectURL(w.start.picture.url);
    setWaiting(null);
    onLeave(undefined);
  }, [onLeave]);
  const stayRef = useRef(stay);
  stayRef.current = stay;
  // 从文件打开的世界放进「我的世界」以后交给 App 打开(worldFileFlow.ts)
  useEffect(() => {
    setOpenWorldHandler((id) => leave({ kind: 'open', id }));
    setOpenWorkHandler(openWork);
    return () => {
      setOpenWorldHandler(null);
      setOpenWorkHandler(null);
    };
  }, [leave, openWork]);
  // 主程序下载不下来、也没法自动刷新重来:不再等(按钮、卡片回到原样,再点一下会重新下载),顶上一条出错的提示带「重新加载」
  useEffect(() => {
    if (!loadFailed) return;
    setWaiting(null);
    showToast({
      id: FAIL_TOAST,
      kind: 'error',
      text: '地图程序没能下载完',
      more: ['网络断了，或者网站刚更新过，重新加载试试'],
      action: { label: '重新加载', act: 'home-reload', onClick: () => location.reload() },
    });
  }, [loadFailed]);
  // 打开存档文件、拖文件进来:顶上一条提示,说下了多少、下好就打开,能取消
  const fileWait = waiting?.kind === 'text' ? waiting : null;
  useEffect(() => {
    if (!fileWait) return;
    showToast({
      id: WAIT_TOAST,
      kind: 'progress',
      text: '正在载入地图程序',
      more: [pct === null ? '网络有点慢' : `网络有点慢，已下载 ${pct}%`, `下好就自动打开${fileWait.fileName ? ` ${fileWait.fileName}` : '存档'}`],
      ...(pct === null ? {} : { progress: pct / 100 }),
      action: { label: '取消', act: 'home-wait-cancel', onClick: stay },
    });
  }, [fileWait, pct, stay]);
  useEffect(() => {
    if (!fileWait) return;
    return () => clearToast(WAIT_TOAST);
  }, [fileWait]);

  useEffect(() => {
    // AI 接入、账号里的世界列表:开了就一直开着,App 挂上以后接着用这一份(App 里再开一次什么都不做)
    setupAi();
    startFullView();
    // 账号窗里点「最近删除」等回到我的世界:已经在这一页
    setGoHome(() => {});
    // 别人分享的规则「用它新建世界」:就在这一页打开新建弹窗,规则选好那一套
    setNewWorldHandler((rules) => setNewDlg({ rules }));
    // 浏览器的后退、前进:这一页先记成我的世界那一步(和 App 一样;App 挂上以后接着记)
    navMark({ page: 'home' });
    // 按后退 / 前进到了这个网站记的另一步:交给 App 照网址打开。
    // 作品墙那一页退回我的世界(按后退、点「‹ 我的世界」)就留在这一页,不用等主程序
    const onPop = () => {
      if (wallUpRef.current && isNavState(history.state) && history.state.page === 'home') {
        setWallUp(false);
        stayRef.current();
        return;
      }
      onLeave(null);
    };
    // 地址栏里自己加了 #:浏览器记了一步、这个网站没记过,也记成一步(和 App 一样);贴的是分享链接,交给 App 照网址打开;
    // 贴的是作品墙的地址,和点了一样
    const onHash = () => {
      const gid = galleryOfUrl(new URLSearchParams(), location.hash);
      if (gid !== null) return pastedRef.current(gid);
      if (!isNavState(history.state)) navAdopt({ page: 'home' });
      // 贴的是规则链接(调规则的入口开着时):就在这一页打开调规则的大卡,# 那段从地址栏去掉
      if (openRulesHash(location.hash)) return navUrl(location.pathname + location.search);
      if (isShareHash(location.hash)) onLeave(null);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    // 浏览器自己的页面缩放不抢捏合(和 App 一样):Safari 的 gesture 事件、Chrome / Firefox 触控板捏合(按着 Ctrl 的滚轮)
    const gStart = (e: Event) => {
      e.preventDefault();
      setGesturePinch(true);
    };
    const gChange = (e: Event) => e.preventDefault();
    const gEnd = () => setGesturePinch(false);
    const isPinch = createPinchGuard();
    const pageZoom = (e: WheelEvent) => {
      if (e.ctrlKey && isPinch(wheelSample(e))) e.preventDefault();
    };
    document.addEventListener('gesturestart', gStart, { passive: false });
    document.addEventListener('gesturechange', gChange, { passive: false });
    document.addEventListener('gestureend', gEnd);
    window.addEventListener('wheel', pageZoom, { passive: false, capture: true });
    return () => {
      setGoHome(null);
      setNewWorldHandler(null);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('gesturestart', gStart);
      document.removeEventListener('gesturechange', gChange);
      document.removeEventListener('gestureend', gEnd);
      window.removeEventListener('wheel', pageZoom, { capture: true });
    };
  }, [onLeave]);
  // 快捷键在我的世界都不管(⌘S 照样拦下,见 useShortcuts.ts)
  useShortcuts(() => false);

  // 把文件拖进页面 = 从文件打开(和 App 一样;我的世界不收图片)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropping) setDropping(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.relatedTarget || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropping(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    withFileFlow(`打不开 ${files[0].name}`, (m) =>
      // 一套规则的文件:就在这一页打开调规则的大卡,不等主程序
      m.openPickedFiles(files, (text, name) => void (openRulesText(text, name) || leave({ kind: 'text', text, fileName: name }))),
    );
  };

  return (
    <div
      className={`app${narrow ? ' phone' : ' has-side'} booting home`}
      data-theme={theme}
      data-layer={layerOf(view.style, view.layer, civShow)}
      data-base={mapBase}
      data-fill={fillOf(civShow)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {wallUp ? (
        <GalleryPage
          phone={narrow}
          onHome={() => history.back()}
          onOpen={(w) => openWork(w.id)}
          onPreset={(preset) => leave({ kind: 'preset', preset })}
          onShown={(id) => {
            // 开着的新建参数 / 规则作品写进网址(和 App 里一样;不算一步):主程序下好以后照网址接着开着它
            navReplace({ page: 'gallery', ...(id ? { id } : {}) });
            navUrl(galleryHref(location.pathname, location.search, id ?? ''));
          }}
        />
      ) : (
        <MyWorlds
          phone={narrow}
          onOpen={(id) => leave({ kind: 'open', id })}
          onNew={() => setNewDlg({})}
          onOpenText={(text, fileName) => leave({ kind: 'text', text, fileName })}
          onNewCiv={(id) => leave({ kind: 'newCiv', id })}
          opening={waiting && (waiting.kind === 'open' || waiting.kind === 'newCiv') ? { id: waiting.id, pct } : null}
          onGallery={showWall}
          onOpenWork={(w) => openWork(w.id)}
        />
      )}
      <RulesHost />
      <ToastBar />
      <AiSettingsHost />
      <AccountHost phone={narrow} />
      <SameWorldHost phone={narrow} />
      <TipLayer />
      {newDlg && (
        <Suspense fallback={null}>
        <NewWorldDialog
          phone={narrow}
          rules={newDlg.rules}
          randomSeed={randomSeedValue}
          onCancel={() => {
            setNewDlg(false);
            stay();
          }}
          onStart={(start) => leave({ kind: 'dialog', start })}
          wait={waiting?.kind === 'dialog' ? { pct } : undefined}
        />
        </Suspense>
      )}
      {dropping && (
        <div className="drop-hint">
          <div>松手打开存档</div>
        </div>
      )}
    </div>
  );
}
