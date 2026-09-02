# 调研:Venus OS gui-v2 —— 用于对标 apid 的功能参考

> **性质与意图。**这是调研笔记,不是设计记录:它记录的是别人的产品,用来
> 衡量 mos 自己的管理面与一个已量产、成熟的设备 UI 之间的差距。它不复述
> 任何 mos 设计;第 14 节把 gui-v2 的每个能力域映射到 mos 中拥有对应面的
> 文档或开放任务。早先的 Venus OS **兼容性**目标已于 2026 年 8 月关闭,
> 本文不重启它——文中没有任何内容提议实现 Venus 的契约、总线名或 topic。
>
> **来源基础。**基于 `github.com/victronenergy/gui-v2` 公开源码通读,
> 标签 v1.3.17(2026-08-28),含 `veutil` 子模块。gui-v2 是 Venus OS 3.50
> 起出货的"New UI",也是唯一仍以源码公开的 Venus UI;gui-v1 已不再公开。
> 遵循本仓库的文档纪律:指名文件与模块,不引行号。快照规模:约 300 个页面
> QML、306 个组件 QML、141 个数据层 QML、124 个 C++ 源文件、21 个翻译文
> 件。下文的设置页清单是对照各页面的翻译 ID 集合核实的,不是从菜单标题
> 推断的。
>
> **粒度。**所有用户可见的面都枚举到页面级;凡控件承载了值得借鉴的决策
> (拒绝文案、模式词汇表、看门狗)则细到控件级。逐字符串转写刻意不做——
> 那是源码本身的职责。

## 1. 产品背景

Venus OS 运行在 Victron 的 GX 能源监控设备上(Cerbo GX、Ekrano GX、
树莓派构建)。gui-v2 是其操作 UI:逆变器/电池/光伏仪表盘、设备配置器和
设置树,呈现在外接触摸屏上,并以完全相同的形态出现在浏览器里
("Remote Console",远程控制台)。

与 mos 的产品平行度很高:可无头运行的 Linux 设备、本地管理守护进程、
外接屏 kiosk、以及一个不依赖厂商云也能工作、接上云则获得远程可达性的
浏览器面。

## 2. 一套代码,三种传输

同一个 Qt6/QML 应用以三种形态出货,启动时选择
(`src/backendconnection.h`):

| 形态 | 数据传输 | 角色 |
|---|---|---|
| 本机 Linux(eglfs) | D-Bus(`VeQItemDbusProducer`) | 设备上的触摸屏 |
| 浏览器 WebAssembly | MQTT(`QMqttClient`),连本地 broker 或 VRM 云 | Remote Console——取代了 gui-v1 的 VNC 截屏方案 |
| Mock | 进程内模拟 producer(`data/mock/`) | 开发与销售演示 |

两个推论决定了整个架构:

- **UI 不执行任何命令。**因为同一个二进制可能跑在远端浏览器里,一切动作
  ——重启、固件升级、乃至创建设置键——都是对数据树的**写值**,由设备上
  独立的 `venus-platform` 服务落地执行。`data/VenusPlatform.qml` 把
  "重启"实现为向 `/Device/Reboot` 写 `true`。UI 进程不需要任何特权,
  也没有本地执行路径。
- **一个数据模型,两个 producer。**全部状态是一棵统一的类型化条目树
  (VeQItem,来自 `veutil` 子模块)。本地时树镜像 D-Bus 服务;远程时
  镜像 MQTT topic(`N/<portalId>/#` 为通知、`W/` 写、`R/` 读请求,外加
  keepalive 与心跳 topic——`veutil/src/qt/ve_qitems_mqtt.cpp`)。QML 用
  声明式的 `VeQuickItem { uid: "..." }` 绑定,元素自带值、有效性、
  最小/最大、单位与小数位(`veutil/inc/veutil/qt/ve_quick_item.hpp`)。
  没有任何页面知道自己跑在哪种传输上。

`BackendConnection` 单例持有连接状态机(Idle → Connecting → Connected →
Initializing → Ready → Disconnected / Reconnecting / Failed)、心跳状态、
VRM 凭据(用户名/密码/token/portal id/shard),以及会让整个 UI 全局降级
为只读的 VRM portal 模式(Off / ReadOnly / Full)。

## 3. 应用外壳

`Main.qml` 与 `pages/MainView.qml` 组合出:

- **状态栏**(`components/StatusBar_Landscape.qml`、`_Portrait`):左键
  切换 Controls 卡片组,在页面栈内则变为返回键;旁边一个键打开 Switches
  开关面板;中间是标题加实时时钟;右侧依次是 WiFi 键(直达 WiFi 设置)、
  GSM 信号图标、通知铃(按最高活动级别着色)、熄屏键。
- **主页面轮播**:4–6 个顶级页面的 `SwipeView` 配底部导航栏;放不下的
  页面折叠进 "More" 对话框。所有数据源就绪后页面才加载
  (`data/DataManager.qml` 以全部领域对象加插件加载器为闸)。
- **页面栈**:设置/设备下钻,带面包屑。
- **对话框层**(模态对话框是独立层,不属于页面)与**toast 层**(分级、
  自动过期)。对话框清单(`components/dialogs/`)约 23 个:数字/时间/
  日期选择器、电流限制、ESS 最低 SOC、逆变/充电器模式、EVCS 模式、
  发电机启动/停止/关闭自启确认、RGB 色轮、安全档密码、VRM 实例交换、
  解配对、光伏日历史、模态警告、"正在重启"阻塞框。
- **空闲行为**:页面可声明 `fullScreenWhenIdle`;起始页可配置——固定
  某页或"自动选择最近使用的视图",带秒级超时,空闲后恢复
  (`data/StartPageConfiguration.qml`);熄屏器与(自动)亮度属于 UI
  进程(`src/screenblanker.cpp`)。
- **降级处理**:监听 settings 与 platform 服务;掉线时外壳弹警告 toast
  并安排服务恢复后整体重载 UI(`src/systemservicelistener.cpp`)。
- **完整键控导航**:所有交互元素都参与 `KeyNavigation`,带全局焦点
  高亮,无触摸设备照常可操作。
- **隐藏维护控制台**:设备构建上 Alt+F2 打开内嵌终端
  (`components/ConsoleTerminal.qml`)。

## 4. 主页面

组合是动态的(`components/SwipePageModel.qml`):Brief、Overview、
Notifications、Settings 恒在;Levels 仅当存在水箱或环境传感器时出现;
Boat 页仅当电动推进设置打开时出现。

### 4.1 Brief(速览)

一眼可读的着陆页。中央:多圈环形仪表——内圈电量 SOC,外圈是可配置的
功率流环(哪些环出现本身就是一个设置页,"Brief view start page")。
侧面板(`pages/BriefSidePanel.qml`):实际在场的每个源/汇各一个紧凑
小部件——光伏产出、发电机(以发电机自己的名字为标题)、非发电机的 AC
输入(按配置的来源类型显示为市电/岸电)、DC 输入、AC 负载、DC 负载——
各带实时功率与可展开的历史曲线。页面监控自己的 CPU 开销,系统负载越限
时自动关闭曲线并 toast 提示(`src/cpuinfo.cpp`)——UI 明确把自己当作
繁忙设备上的客人。

### 4.2 Overview(总览)

实时能流图。布局引擎用 19 种 widget 类型(`src/enums.h`)组合三列:
左列——AC 输入 1/2(市电、岸电、发电机)、光伏、交流发电机
(alternator)、直流发电机、燃料电池、通用 DC 源、AC 充电器、DC 充电
器、水力/轴带/风力发电机;中列——逆变/充电器、电池;右列——AC 负载、
关键负载、DC 负载、EV 充电桩。widget 按在场数量调整尺寸,之间用动画
连接线表示瞬时功率方向,点击进入对应设备页。竖屏构建换成同一组 widget
的纵向滚动变体。

### 4.3 Levels(液位)

两个 Tab。Tanks:每个水箱一条条形仪表(燃油、清水/灰水/黑水、机油、
LPG——按液体类型着色),聚合重复的发送器,可展开明细
(`src/aggregatetankmodel.cpp`)。Environment:每个传感器的温度/湿度/
气压仪表。

### 4.4 Notifications(通知)

活动与历史告警同列表,三个级别(alarm / warning / info),逐行点击
确认,存在未确认的告警/警告时显示整批 "Silence" 按钮,info 级自动确认,
与状态栏/导航栏角标联动(`data/Notifications.qml`、
`src/notificationmodel.cpp`)。

### 4.5 Boat(可选)

电动推进领域仪表盘(`pages/boat/`):中央电机仪表(功率/转速)、电池
弧形表带百分比与续航时间、里程、档位指示、岸电弧、能耗表、GPS 航速、
多电机、多路温度表。

### 4.6 Settings(设置)

见第 6 节。

## 5. 快捷控制

两组卡片从状态栏滑出、盖在当前页面上,常规操作永远不必进设置树。

**Control 卡片**(`pages/controlcards/`),每个可控子系统一张:

- **ESS 卡**:从 BatteryLife 状态机读出当前 ESS 状态;最低 SOC 数字
  对话框;"生效 SOC 限值"读数,与配置值不同时用 toast 解释原因。
- **逆变/充电器卡**:按能力自称 "Inverter" 或 "Inverter/charger";
  模式键(开 / 关 / 仅充电 / 仅逆变,`InverterChargerModeDialog`);
  AC 输入电流限制对话框;有 ESS 时显示最低 SOC。
- **发电机卡**:自动启动开关,链接到启停条件页;手动启动对话框
  (运行时长)、停止对话框、"关闭自动启动"确认对话框。
- **EVCS 卡**:充电模式对话框(手动 / 自动 / 定时)、充电电流数字
  调节、允许充电开关。

**Switches 面板**(`pages/AuxCardsPage.qml`):面向用户的可切换输出,
按组成卡。四种输出类型——瞬动、翻转、调光、温度设定点
(`src/switchableoutput.cpp`)——配滑条、数字调节和 RGB 色轮对话框;
通道可改名、分组、单独隐藏(`components/listitems/ListIOChannel*.qml`)。

## 6. 设置树

八个顶级分支(`pages/SettingsPage.qml`),`pages/settings/` 下约 130
页。值得借鉴的是纪律本身:每一行都是从一套小而共享的词汇表(开关、
数字调节、单选页、导航行、量值组——`components/listitems/`)里取出的
`VeQuickItem` 绑定列表项,所以新增一个设置页是数据描述,不是新 UI
代码。以下清单按页核实自源码。

### 6.1 General(通用)

- **System**:设备身份、序列号、VRM portal id。
- **Firmware**(`PageSettingsFirmware*`):三个子面——
  **在线更新**:更新通道选择(official / beta / testing / develop)、
  自动更新策略(关 / 仅检查 / 检查并下载 / 检查并安装)、手动检查、
  带进度与构建时间戳的安装。**从 SD/USB 安装**:扫描可移动介质中的
  镜像,列出找到的内容,离线安装。**已存备份固件**
  (`PageSettingsRootfsSelect`):显示当前与备份 rootfs 版本及
  "启动到该版本"动作;不可切换时给出具名拒绝理由(无备份、安全档
  不确定)。
- **Access & security**(`PageSettingsAccessAndSecurity`):访问级别
  (User / User & Installer 带密码质询 / Superuser / Service——后两者
  在选择器中只读),本地网络安全档(Secured / Weak / Unsecured,
  单一三档选择配说明文案,切换时弹密码对话框,并警告页面将重载)。
- **Preferences、Display & appearance**
  (`PageSettingsDisplayAndAppearance`):亮度、自适应亮度、熄屏超时
  (10 秒–30 分钟/从不)、暗色/亮色、**独立的** Remote Console 外观
  策略(跟随 GX 屏 / 跟随浏览器主题 / 强制,并解释"被 VRM/被 App
  强制")、起始页配置、Brief 页环配置、Boat 页开关、单位制
  (公制/英制等)、最大最小值显示开关、UI 动画开关,以及按面独立的
  经典 UI/新 UI 切换(本机屏与 Remote Console 各选各的)。
- **Alarms & feedback**:蜂鸣告警开关、状态 LED 开关。
- **Language**:21 种语言含 zh_CN;运行时切换,带进度与成败反馈;
  按语言加载字体。
- **Date & time**:时区树(`tz/`)、NTP 与手动。
- **Documentation**:手册链接渲染成二维码供手机扫
  (`components/listitems/ListLink.qml`,内嵌 QZXing)。
- **Support status**:可支持性自检——检测 rootfs 是否被改动、按名字
  列出在跑的第三方集成(Modbus TCP server、Signal K、Node-RED)、
  标记不受支持的设备,否则声明"干净"。
- **Demo mode**:场景预设(ESS 演示、船用/房车演示)配说明文案;
  演示数据随生产二进制出货。

### 6.2 Connectivity(连接)

- **Ethernet**(`PageSettingsTcpIp`):DHCP/静态、DNS,链路实时监视
  ("连接丢失"、"网线拔出")。
- **WiFi**(`PageSettingsWifi`):扫描到的网络列表、隐藏 SSID 加入、
  密码更新反馈、**AP 模式**(创建 AP、AP 密码、关闭 AP 确认),以及
  带"确定吗"步骤的网关模式关闭。
- **Bluetooth**:启用,并明确标注"供 VictronConnect App 使用";
  报告无适配器。
- **Mobile network**(`PageSettingsGsm`):调制解调器状态、APN/PIN;
  报告"未连接蜂窝调制解调器"。
- **VE.Can / CAN-bus**(`PageSettingsCanbus`、`CanbusProfile`、
  `PageCanbusStatus`):按端口的 profile 选择、总线实时状态、设备
  发现、CAN-over-TCP 调试开关。
- **Modbus TCP** 客户端/服务器面(也可从 Integrations 进入)。

### 6.3 VRM(云记录器,`PageSettingsLogger`)

连接状态带分通道诊断(HTTP、HTTPS、realtime/MQTT、RPC 各通道;具名
错误码 150–157)、最后联络时间戳、上报间隔(1 分钟–1 天)、HTTPS
开关、流量计数,以及**失联重启看门狗**——portal 失联超过配置时长就
重启 GX。按设备的 VRM 实例管理(`PageVrmDeviceInstances`)带冲突
交换对话框。

### 6.4 Integrations(集成)

分组为:**物理 IO**——继电器(每路功能:告警继电器 / 发电机启停含
辅助继电器 / 水箱泵 / 手动 / 温度规则;常开/常闭极性;某功能占用
继电器后页面会告诉你控制入口挪去了哪里)、数字输入;**设备集成**——
电表、PV 逆变器(Fronius/SolarEdge 等:发现、逐台配置、IP 列表管理)、
水箱与温度传感器、蓝牙传感器(Ruuvi)、Shelly 设备、MQTT 设备、EEBUS
设备、Modbus 设备(发现、添加、逐设备页)、Modbus TCP server;
**服务器应用**——"Venus OS Large" 特性集,带启用开关与安全模式:
Node-RED、Signal K,配文档链接与社区指引;**UI 插件**——已装插件
列表,插件可与设备列表集成(第 13 节)。

### 6.5 System setup(系统设置)

- **系统名称**:自动,或预设名(船 / 车辆),或自定义文本。
- **AC system**(`PageSettingsAcSystem`):AC 输入 1/2 的来源类型
  (市电/岸电/发电机)、输入优先级。
- **Inputs and monitoring**(`PageSettingsBatteryMeasurements`):哪些
  电池服务可见、哪个是系统电池监视器;"有 DC 系统"开关。
- **Batteries & BMS**(`PageSettingsBatteries`):电池列表与逐电池
  设置。
- **Charge control / DVCC**(`PageSettingsDvcc`):DVCC 总开关,按
  电池类型自动选择("auto-selected: …/none");主控 BMS 选择;托管
  电池充电电压限制;最大充电电压;共享电压/温度/电流检测(温度检测
  带传感器选择),每项都有具名的不可用原因(外部控制、无电池监视器、
  无充电器);充电电流限制页;MK3/USB 控制开关配说明。
- **ESS / Hub-4**(`PageSettingsHub4`):模式(带 BatteryLife 的
  自发自用 / 不带 / 保持满充 / 外部控制);BatteryLife 状态读数
  (自发自用 / 禁止放电 / 慢充 / 维持 / 回充);最低 SOC 与生效 SOC
  限值;并网设定点;分相与总量调节;馈网(AC/DC 耦合余电,限值);
  最大充/放电功率与百分比;电网计量(逆变器内部 vs 外部电表,按拓扑
  给出必需/可选说明);定时充电窗口(`ListChargeSchedule`);削峰
  (`PageSettingsHub4Peakshaving`);对已废弃模式的弃用提示。
- **Dynamic ESS**(`PageSettingsDynamicEss`):电价驱动调度——买/卖
  价配置、目标 SOC,与机会负载特性互锁("先关 OL")。
- **Generator start/stop**(`PageSettingsGenerator`、
  `PageGeneratorConditions`、`GeneratorCondition`):条件集——电池
  SOC、电压、电流、逆变器高温、过载、AC 负载——每项双向启/停阈值加
  安静时段专用值;周期性试运行;最短运行时间;暖机与冷却时间(带跳过
  规则和"此机组不可用"提示);到水箱液位即停(带警告);AC 输入恢复
  即停;失联行为;在 AC 或 DC 输入侧检测发电机在场;"非自动启动状态
  时告警"(带解释);安静时段窗口。
- **机会负载 / 可控设备**(`PageControllableLoads*`):可控负载
  (EVCS、电池、S2 资源管理器)的自动化、偏好与逐设备页。
- **System status**(`PageSettingsSystemStatus`):控制环路实时诊断
  ——太阳能充电器电压/电流控制状态、VE.Bus 链路、BMS 参数、VE.Bus
  与电池监视器间的 SOC 同步。
- **DC genset** 与**水箱泵**配置。

### 6.6 Devices(设备)

设备列表——第 7 节。

### 6.7 Debug & develop(超级用户可见)

对整个 VeQItem 空间的实时树浏览器,**可写**
(`pages/settings/debug/PageDebugVeQItems.qml`);功率流调试
(`PagePowerDebug`、`PageHub4Debug`);原始系统数据;demo 配置。调试
面就是产品面的同一数据平面,只是不加过滤。

## 7. 设备模型与设备页

每个接入产品都是树上的一个服务;C++ 模型做聚合、过滤、排序
(`src/aggregatedevicemodel.cpp`、`src/filtereddevicemodel.cpp`、
`src/classandvrminstancemodel.cpp`)。设备列表
(`pages/settings/devicelist/`)把每个服务类路由到专属页面套件:

- **电池**:详情、参数、历史、告警、逐模块告警、BMS 专属套件
  (Lynx Ion:系统/诊断/IO/电池信息;配电器列表;48TL 诊断)、
  保险丝信息。
- **VE.Bus 逆变/充电器**(`pages/vebusdevice/`):总览、高级页、逐项
  告警设置、kWh 计数器、逐机序列号、BMS 页、Error-11 引导式诊断套件、
  AC 传感器、微电网页、设备配置备份/恢复、调试页。
- **太阳能充电器**(`pages/solar/`):设备页、逐日历史(柱状对话框)、
  逐跟踪器明细、并联运行、PV 逆变器页。
- **电表与源**:AC 电表(含 Smappee CT 配置向导)、DC 电表(告警、
  含循环列表的历史)、交流发电机、DC-DC 变换器、AC 充电器。
- **其他**:发电机组(含机组错误模型)、电机驱动、气象传感器、GPS、
  数字输入、温度发送器、水箱发送器(传感器配置、形状标定表、告警)、
  脉冲计数器、开关设备——以及明确的"不支持设备"兜底页,仍显示身份
  与连接事实。
- **EV 充电桩**(`pages/evcs/`):列表、逐桩页(本次充电电量与时长、
  充电模式、自动模式功率来源内部/外部、允许充电)、首次配置页。

值得注意的模式:**设备页由设备自己发布的那棵树生成**,所以新增设备类
的成本是一套页面,不是一次协议变更。

## 8. 告警与通知模型

告警是数据,不是 UI 事件:设备发布告警条目;C++ 模型
(`src/notificationmodel.cpp`)把它们折叠成带确认状态的活动/非活动
列表;同一模型驱动铃铛图标、导航栏角标、通知页和 "silence" 语义。
toast 是另一条瞬态通道(`ToastModel`),用于 UI 本地结果(模式已切换、
服务掉线、CPU 过高)。

## 9. 横切机制

- **主题**:颜色(暗/亮加设计 token)、几何、字体、动画时长全是 JSON
  文档(`themes/`),由 `src/theme.cpp` 装载。屏幕尺寸适配是**几何
  主题整体切换**(5 寸/7 寸/竖屏),不是流式缩放——每套布局按屏幕类
  逐像素设计。
- **单位**:单一换算层(`src/units.cpp`,枚举在 `src/enums.h`)处理
  公英制、温标、体积、距离与速度;页面在绑定上声明源单位与显示单位,
  从不内联换算。
- **i18n**:21 个 `.ts` 语言含 zh_CN;运行时切换;按语言选字体。
- **引导**:首次启动导览(`pages/welcome/`)逐页介绍新 UI,升级后
  提供 "what's new"。
- **演示模式**:每个领域都有完整 mock 实现(`data/mock/`),随生产
  二进制出货,设置里可选多种场景预设,屏上有 demo 指示条。

## 10. 访问控制与安全姿态

- **访问级别**:User、User & Installer、Superuser、Service——级别是
  密码门控的 UI 过滤器;行与整个分支声明显示所需的最低级别
  (`showAccessLevel`)。
- **安全档**:单一三档选择——Secured / Weak / Unsecured——把本地
  网络的传输与密码策略打包,切换时弹密码对话框。一个旋钮,不是矩阵。
- **VRM 只读模式**:云中继可被限为只读,由于写路径唯一,整个 UI
  自动遵守。

## 11. Remote Console(WASM 形态)

浏览器构建就是同一份 QML 编译成 WebAssembly(`wasm/`,CI 工作流
`build-wasm.yml`),由设备自己或 VRM portal 提供。数据走 MQTT;对
VRM 时客户端先从保留 topic 发现 portal id,再订阅该 portal 的命名
空间,并强制 broker 心跳——心跳失效时 UI 可见地降级,而不是继续显示
陈旧数字。对 VRM 登录用 `BackendConnection` 持有的账号或 token 凭据;
局域网形态无需凭据。Victron 接受并写明的后果:设备上的 QML 文件可被
拥有者热改,但 WASM 二进制不能——这正是官方插件机制(第 13 节)存在
的原因。

## 12. 测试与开发工具

模型级单元测试(QtTest)覆盖 C++ 聚合/过滤模型与后端连接
(`tests/`);有一套自研 UI 测试步进框架(`src/uitest.cpp`);mock
后端同时充当演示模式;CI 构建 WASM 形态。没有端到端浏览器测试——
mock 传输就是集成接缝。

## 13. 可扩展性与 UI 可替换性

- **插件加载器**(`src/guiplugins.h`):监视插件目录(远程形态改为经
  MQTT 拉取插件清单),加载带自有翻译的打包 QML 资源束,提供五个
  集成点——设置页、设备列表页、导航页、快捷面板、Controls/Switches
  卡组内的卡片。版本上下界
  (`minRequiredVersion`/`maxRequiredVersion`)门控加载。
- **UI 选择**:设置里按面暴露"经典 UI vs 新 UI"(本机屏与 Remote
  Console 各自独立)——新旧 UI 并行出货了多个版本。

## 14. 对 mos 的对标映射

gui-v2 展示的能力,映射到 mos 今天承载(或欠着)对应物的位置。能源
领域本身(ESS、DVCC、光伏、船用)是 Victron 的产品,不映射任何东西;
**管理面**才是基准。

| gui-v2 能力域 | mos 现在的归属 |
|---|---|
| 单一 API/数据平面,UI 只写值、不执行 | `docs/design/api.md`——apid 的 `/api` 唯一契约;姿态相同,用 HTTP 而非值树 |
| 本机 kiosk 与远程浏览器同一个 UI | `docs/design/display.md`(cage+WPE 渲染 apid 自己的 UI)——mos 统一得比 Victron 更彻底 |
| 连接状态机、心跳、可见的数据陈旧性 | apid 会话模型;dashboard 侧还没有陈旧性契约——与 `docs/design/dashboard.md` 相关 |
| 通知:级别模型、确认、角标、历史 | mos 尚无对应物;最近的归属是 RFCT-288(诊断)与 dashboard 提案 |
| 设置树:统一绑定行、生成式页面 | `docs/design/mosd.md` 设置 schema + `docs/design/dashboard.md` 信息架构 |
| 设备列表按类分页套件、"不支持"兜底页 | mos 对应物是存储设备与服务——RFCT-285 |
| 连接设置(以太网/WiFi/AP、实时链路状态) | `docs/design/connd.md`、`GET /api/v1/network`;gui-v2 的 WiFi/GSM 状态栏交互是 dashboard 参考 |
| 云记录器诊断:分通道具名错误、最后联络、失联重启看门狗 | mos 无对应物;**分通道具名错误**的模式直接适用于 RFCT-288 与未来的舰队通道(`docs/design/remote-management.md`) |
| 固件在线/离线更新 + 带具名拒绝的显式回滚页 | RFCT-283(认证更新)、RAUC A/B + `docs/design/uboot-ab-handshake.md`;**从可移动介质离线安装**与 RFCT-284 的恢复思路吻合 |
| 访问级别 + 单旋钮安全档 | `docs/design/access.md`;Secured/Weak/Unsecured 单旋钮是 lockdown 分层的 UX 基准 |
| 支持状态页(检测改动、点名在跑的集成、自报可支持性) | mos 无对应物;对出货设备便宜且有价值 |
| 首次启动引导 | RFCT-282(安装、开箱、预配置) |
| 随产品出货的演示模式与 mock 数据 | mos 无对应物;dashboard 可考虑(销售/开发价值,运行时成本近零) |
| 时间/时区设置页 | RFCT-280 |
| 对实时数据平面的调试树浏览器 | apid 的 OpenAPI + 总线检查;RFCT-288 下值得考虑一个原始面调试页 |
| 插件/集成点、可替换 UI | apid 的受校验自定义 UI 机制(`/api/v1/ui`)在整体可替换性上已超过 gui-v2 的插件故事,但没有**局部**集成点 |
| 数据化主题、几何主题响应式、i18n、单位层 | dashboard 提案;都还不是契约 |

用于 apid/dashboard 功能审计的阅读顺序:第 3–7、10 节是设备管理核心;
第 2、11 节解释让一个 UI 服务两种传输的架构手法;第 13 节仅当 mos
想要第三方局部扩展(而非整体替换 UI)时才相关。
