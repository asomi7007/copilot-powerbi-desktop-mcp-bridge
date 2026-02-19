# 🔗 Copilot + Power BI Desktop MCP Bridge

Power BI Desktop의 데이터 모델을 Microsoft Copilot Studio에서 활용할 수 있게 해주는 HTTP Bridge 서비스입니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](https://www.microsoft.com/windows)

---

## 📋 목차

- [개요](#-개요)
- [아키텍처](#️-아키텍처)
- [빠른 시작 (5분)](#-빠른-시작-5분)
- [상세 설치 가이드](#-상세-설치-가이드)
- [설정](#️-설정)
- [Power Platform 연결 설정](#-power-platform-연결-설정)
- [사용법](#-사용법)
- [문제 해결](#-문제-해결)
- [개발자 가이드](#-개발자-가이드)
- [라이선스](#-라이선스)

---

## 🎯 개요

이 프로젝트는 **Copilot Studio**가 로컬 PC의 **Power BI Desktop** 데이터 모델에 직접 접근할 수 있도록 하는 Bridge 역할을 합니다.

### 해결하는 문제

- ❌ **기존 방식**: Copilot Studio는 클라우드 서비스만 연결 가능
- ❌ Power BI Desktop의 로컬 모델은 Copilot에서 직접 접근 불가
- ✅ **이 솔루션**: HTTP Bridge를 통해 로컬 모델과 클라우드 Copilot을 연결

### 주요 기능

- 🔌 **MCP 프로토콜 지원**: Model Context Protocol을 통한 표준화된 통신
- 🌐 **HTTP REST API**: Copilot Studio Custom Connector와 호환
- 🔒 **보안 설계**: localhost 바인딩, 선택적 API Key 인증
- 🚀 **간편한 설치**: 실행 파일 하나로 즉시 실행 가능
- 📊 **Power BI 데이터 접근**: 테이블, 컬럼, DAX 쿼리 실행 등

### 사용 사례

1. **자연어 질의**: "지난 달 매출은 얼마야?" → DAX 쿼리 자동 생성 및 실행
2. **데이터 탐색**: "이 모델에 어떤 테이블이 있어?" → 메타데이터 조회
3. **리포트 자동화**: Copilot이 Power BI 데이터를 기반으로 인사이트 생성

---

## 🏗️ 아키텍처

```
┌─────────────────────┐
│  Copilot Studio     │  ← 클라우드
└──────────┬──────────┘
           │ HTTPS
           ▼
┌─────────────────────┐
│  On-premises        │  ← Gateway
│  Data Gateway       │
└──────────┬──────────┘
           │ HTTP
           ▼
┌─────────────────────┐
│  HTTP Bridge        │  ← 이 프로젝트 (localhost:5050)
│  (Node.js)          │
└──────────┬──────────┘
           │ stdio (MCP)
           ▼
┌─────────────────────┐
│ powerbi-modeling    │  ← MCP 서버
│ -mcp.exe            │
└──────────┬──────────┘
           │ COM/API
           ▼
┌─────────────────────┐
│  Power BI Desktop   │  ← 로컬
└─────────────────────┘
```

### 통신 흐름

1. **Copilot Studio** → Gateway에 요청 (HTTPS)
2. **Gateway** → Bridge에 전달 (HTTP, 로컬 네트워크)
3. **Bridge** → MCP 프로세스와 stdio 통신
4. **MCP** → Power BI Desktop과 상호작용 (COM)
5. 응답은 역순으로 전달

---

## ⚡ 빠른 시작 (5분)

### 방법 1: 실행 파일 다운로드 (권장 - 비개발자)

1. **사전 요구사항 확인**
   - Windows 10/11
   - Power BI Desktop 설치 및 실행 ([다운로드](https://powerbi.microsoft.com/desktop/))
   - `powerbi-modeling-mcp.exe` 다운로드 (TODO: 링크 추가)

2. **Bridge 다운로드**
   - [Releases 페이지](../../releases)에서 최신 `pbi-mcp-bridge-win-x64-vX.X.X.zip` 다운로드
   - 압축 해제 (예: `C:\pbi-mcp-bridge\`)

3. **실행**
   ```powershell
   # PowerShell에서 실행
   cd C:\pbi-mcp-bridge
   .\scripts\start.ps1
   ```

4. **확인**
   - 브라우저에서 http://localhost:5050/health 접속
   - `"status": "ok"` 메시지 확인

### 방법 2: PowerShell 원클릭 설치

```powershell
# PowerShell을 관리자로 실행한 후
irm https://raw.githubusercontent.com/your-org/copilot-powerbi-desktop-mcp-bridge/main/scripts/install.ps1 | iex
```

### 방법 3: 소스에서 설치 (개발자)

```bash
# Node.js 20 이상 필요
git clone https://github.com/your-org/copilot-powerbi-desktop-mcp-bridge.git
cd copilot-powerbi-desktop-mcp-bridge
npm install
npm run build
npm start
```

---

## 📖 상세 설치 가이드

### 사전 요구사항

#### 필수 소프트웨어

| 소프트웨어 | 버전 | 용도 | 다운로드 |
|-----------|------|------|----------|
| **Windows** | 10/11 | 운영체제 | - |
| **Power BI Desktop** | 최신 | 데이터 모델 제공 | [링크](https://powerbi.microsoft.com/desktop/) |
| **powerbi-modeling-mcp.exe** | - | MCP 서버 | TODO: 링크 추가 |

#### 선택 사항

| 소프트웨어 | 필요 시점 | 다운로드 |
|-----------|----------|----------|
| **Node.js 20+** | 소스에서 설치 시 | [링크](https://nodejs.org/) |
| **Git** | 소스 clone 시 | [링크](https://git-scm.com/) |
| **On-premises Data Gateway** | Copilot 연결 시 | [링크](https://powerbi.microsoft.com/gateway/) |

### 설치 단계

#### 1단계: powerbi-modeling-mcp.exe 준비

1. `powerbi-modeling-mcp.exe` 다운로드 (TODO: 링크)
2. Bridge와 같은 폴더에 배치하거나 경로를 [`config.yaml`](config.yaml)에 지정

```yaml
mcp:
  command: "C:\\path\\to\\powerbi-modeling-mcp.exe"
```

#### 2단계: Bridge 설치

**옵션 A: 실행 파일 (권장)**

1. [Releases](../../releases)에서 zip 다운로드
2. 원하는 위치에 압축 해제 (예: `C:\pbi-mcp-bridge\`)
3. 설정 파일 준비:
   ```powershell
   copy config.example.yaml config.yaml
   ```

**옵션 B: npm 설치**

```bash
npm install -g copilot-powerbi-desktop-mcp-bridge
# 또는 로컬 설치 후
npm start
```

#### 3단계: 서비스 시작

```powershell
# 수동 실행
.\scripts\start.ps1

# 또는 Windows 시작 시 자동 실행 (관리자 권한 필요)
.\scripts\register-startup.ps1
```

#### 4단계: 동작 확인

```powershell
# 상태 확인
curl http://localhost:5050/health

# 또는 브라우저에서 http://localhost:5050/health 접속
```

**정상 응답 예시:**
```json
{
  "status": "ok",
  "bridge": {
    "version": "1.0.0",
    "uptime": 120
  },
  "mcp": {
    "connected": true,
    "exe": "powerbi-modeling-mcp.exe",
    "pid": 12345
  }
}
```

---

## ⚙️ 설정

### config.yaml

Bridge의 동작을 제어하는 메인 설정 파일입니다.

```yaml
# HTTP 서버 설정
server:
  port: 5050              # 포트 번호 (기본: 5050)
  host: "127.0.0.1"       # 바인딩 주소 (보안상 localhost 권장)

# MCP 서버 설정
mcp:
  command: "powerbi-modeling-mcp.exe"  # MCP 실행 파일 경로
  args: []                              # 추가 명령줄 인수
  # cwd: "C:\\path\\to\\mcp"           # 작업 디렉토리 (선택)
  startupTimeoutMs: 10000               # 시작 타임아웃 (밀리초)
  requestTimeoutMs: 30000               # 요청 타임아웃 (밀리초)

# 보안 설정
security:
  # apiKey: "your-secret-key"          # API Key 인증 (주석 해제하여 활성화)
  corsOrigins:
    - "*"                               # CORS 허용 도메인

# 로깅 설정
logging:
  level: "info"                         # debug, info, warn, error
  # file: "logs/bridge.log"            # 로그 파일 경로 (선택)
```

### 환경변수 (.env)

간단한 설정은 환경변수로도 가능합니다. [`config.yaml`](config.yaml)보다 우선순위가 높습니다.

```env
PORT=5050
HOST=127.0.0.1
MCP_COMMAND=powerbi-modeling-mcp.exe
API_KEY=your-secret-key-here
LOG_LEVEL=info
```

### 설정 우선순위

```
명령줄 인수 > 환경변수 (.env) > config.yaml > 기본값
```

### 주요 설정 항목 설명

| 항목 | 기본값 | 설명 |
|------|--------|------|
| `server.port` | `5050` | HTTP 서버 포트 |
| `server.host` | `127.0.0.1` | 바인딩 주소 (외부 접근 차단) |
| `mcp.command` | `powerbi-modeling-mcp.exe` | MCP 실행 파일 |
| `mcp.requestTimeoutMs` | `30000` | MCP 응답 대기 시간 (30초) |
| `security.apiKey` | (비활성화) | API Key 인증 활성화 |
| `logging.level` | `info` | 로그 레벨 |

---

## 🔌 Power Platform 연결 설정

Copilot Studio에서 Bridge를 사용하려면 다음 단계를 따르세요.

### 1단계: On-premises Data Gateway 설치

1. **Gateway 다운로드 및 설치**
   - [On-premises Data Gateway](https://powerbi.microsoft.com/gateway/) 다운로드
   - 설치 후 Microsoft 계정으로 로그인

2. **Gateway 구성**
   - Gateway 이름 지정 (예: "MyPC-Gateway")
   - 복구 키 설정 및 백업

3. **Gateway 상태 확인**
   - Power Platform 관리 센터에서 Gateway 목록 확인
   - 상태가 "온라인"인지 확인

### 2단계: Custom Connector 생성

1. **Power Platform 관리 센터 접속**
   - https://make.powerapps.com 이동
   - 환경 선택

2. **Custom Connector 만들기**
   - 왼쪽 메뉴: **데이터** → **사용자 지정 커넥터**
   - **+ 새 사용자 지정 커넥터** → **OpenAPI 파일에서 가져오기**

3. **Swagger 파일 업로드**
   - 이 프로젝트의 [`connector/apiDefinition.swagger.json`](connector/apiDefinition.swagger.json) 파일 업로드
   - 커넥터 이름: "Power BI MCP Bridge"

4. **호스트 설정**
   - **일반** 탭에서:
     - 호스트: `localhost:5050` → Gateway를 통해 접근하므로 localhost 유지
   - **보안** 탭:
     - 인증 유형: "API 키" (Bridge에서 `apiKey`를 설정한 경우)
     - 또는 "인증 없음" (기본 설정)

5. **커넥터 만들기**
   - 오른쪽 위 **커넥터 만들기** 클릭

### 3단계: 연결 생성

1. **연결 추가**
   - **데이터** → **연결** → **+ 새 연결**
   - 방금 만든 "Power BI MCP Bridge" 선택

2. **Gateway 선택**
   - "온-프레미스 데이터 게이트웨이 사용" 체크
   - 1단계에서 설치한 Gateway 선택

3. **연결 테스트**
   - 연결 생성 후 "테스트" 버튼 클릭
   - Health Check 작업 실행하여 성공 확인

### 4단계: Copilot Studio에서 Tool 추가

1. **Copilot Studio 접속**
   - https://copilotstudio.microsoft.com
   - 챗봇 선택 또는 새로 생성

2. **Tool 추가**
   - 왼쪽 메뉴: **작업** → **커넥터**
   - "Power BI MCP Bridge" 커넥터 추가

3. **작업 구성**
   - `McpRequest` 작업을 사용하여 MCP 요청 전송
   - 예시 파라미터:
     ```json
     {
       "jsonrpc": "2.0",
       "id": "1",
       "method": "tools/list",
       "params": {}
     }
     ```

4. **테스트**
   - Copilot 테스트 창에서 질문:
     - "테이블 목록을 보여줘"
     - "매출 테이블의 정보를 알려줘"

---

## 📖 사용법

### API 직접 호출

#### 1. 상태 확인

```bash
curl http://localhost:5050/health
```

**응답:**
```json
{
  "status": "ok",
  "bridge": {
    "version": "1.0.0",
    "uptime": 3600
  },
  "mcp": {
    "connected": true,
    "exe": "powerbi-modeling-mcp.exe",
    "pid": 12345
  }
}
```

#### 2. 사용 가능한 도구 목록 조회

```bash
curl -X POST http://localhost:5050/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/list",
    "params": {}
  }'
```

**응답 예시:**
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "tools": [
      {
        "name": "execute_dax",
        "description": "Execute a DAX query against the Power BI model",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": { "type": "string" }
          },
          "required": ["query"]
        }
      },
      {
        "name": "list_tables",
        "description": "List all tables in the model"
      }
    ]
  }
}
```

#### 3. 도구 실행 (DAX 쿼리 예시)

```bash
curl -X POST http://localhost:5050/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "name": "execute_dax",
      "arguments": {
        "query": "EVALUATE ROW(\"Total Sales\", SUM(Sales[Amount]))"
      }
    }
  }'
```

### Copilot Studio에서 사용

Copilot Studio의 Topics에서 Custom Connector 작업을 사용합니다:

1. **트리거 설정**: 사용자 질문 인식
2. **작업 실행**: `McpRequest` 호출
3. **응답 처리**: 결과를 자연어로 변환하여 답변

**예시 플로우:**
```
사용자: "매출 테이블에 어떤 컬럼이 있어?"
  ↓
Copilot: tools/call("describe_table", {"table": "Sales"})
  ↓
Bridge → MCP → Power BI Desktop
  ↓
응답: { "columns": ["Date", "Amount", "Customer", ...] }
  ↓
Copilot: "매출 테이블에는 Date, Amount, Customer 등의 컬럼이 있습니다."
```

---

## 🔧 문제 해결

### MCP 프로세스가 시작되지 않음

**증상:**
```json
{
  "status": "error",
  "mcp": {
    "connected": false
  }
}
```

**해결 방법:**

1. **MCP 파일 경로 확인**
   ```powershell
   # config.yaml에서 경로 확인
   Get-Content config.yaml | Select-String "command"
   
   # 파일 존재 확인
   Test-Path "powerbi-modeling-mcp.exe"
   ```

2. **수동 실행 테스트**
   ```powershell
   .\powerbi-modeling-mcp.exe
   # 에러 메시지 확인
   ```

3. **로그 확인**
   ```powershell
   # Bridge 로그 확인 (logging.file 설정한 경우)
   Get-Content logs\bridge.log -Tail 50
   ```

### Power BI Desktop 연결 실패

**증상:** MCP는 실행되지만 Power BI 데이터에 접근 불가

**해결 방법:**

1. **Power BI Desktop 실행 확인**
   ```powershell
   Get-Process -Name "PBIDesktop" -ErrorAction SilentlyContinue
   ```

2. **Power BI Desktop에서 파일 열기**
   - 빈 상태가 아닌 `.pbix` 파일을 열어야 함

3. **외부 도구 연결 허용 확인**
   - Power BI Desktop 옵션 → 보안 → "외부 도구 연결 허용" 체크

### Gateway 연결 안됨

**증상:** Copilot Studio에서 "Gateway를 사용할 수 없습니다" 오류

**해결 방법:**

1. **Gateway 상태 확인**
   - Windows 서비스에서 "On-premises data gateway service" 실행 중인지 확인
   - Power Platform 관리 센터에서 Gateway 상태 "온라인" 확인

2. **방화벽 설정**
   - Bridge 포트(기본 5050) 인바운드 규칙 추가
   ```powershell
   New-NetFirewallRule -DisplayName "PBI MCP Bridge" -Direction Inbound -LocalPort 5050 -Protocol TCP -Action Allow
   ```

3. **네트워크 바인딩**
   - [`config.yaml`](config.yaml)의 `server.host`를 `0.0.0.0`으로 변경하여 모든 네트워크 인터페이스에서 수신
   - ⚠️ 보안 주의: 방화벽 설정 필수

### API Key 인증 오류

**증상:** `401 Unauthorized`

**해결 방법:**

1. **API Key 확인**
   ```yaml
   # config.yaml
   security:
     apiKey: "your-key-here"
   ```

2. **헤더 추가**
   ```bash
   curl -H "X-API-Key: your-key-here" http://localhost:5050/health
   ```

3. **Custom Connector 설정**
   - 보안 탭에서 "API 키" 인증 유형 선택
   - 연결 시 API Key 입력

---

## 👨‍💻 개발자 가이드

### 프로젝트 구조

```
copilot-powerbi-desktop-mcp-bridge/
├── src/
│   ├── index.ts                 # 엔트리포인트
│   ├── server.ts                # Express 서버 설정
│   ├── config.ts                # 설정 로더
│   ├── logger.ts                # Winston 로거
│   ├── mcp-client.ts            # MCP 클라이언트
│   ├── types.ts                 # TypeScript 타입 정의
│   ├── middleware/              # Express 미들웨어
│   │   ├── auth.ts              # API Key 인증
│   │   ├── request-logger.ts    # 요청 로깅
│   │   └── error-handler.ts     # 에러 핸들러
│   └── routes/                  # API 라우트
│       ├── mcp.ts               # POST /mcp
│       └── health.ts            # GET /health
├── scripts/                     # PowerShell 스크립트
│   ├── install.ps1              # 설치 스크립트
│   ├── start.ps1                # 시작 스크립트
│   ├── stop.ps1                 # 중지 스크립트
│   └── register-startup.ps1     # 시작프로그램 등록
├── connector/                   # Power Platform Custom Connector
│   ├── apiDefinition.swagger.json
│   └── apiProperties.json
├── .github/workflows/           # GitHub Actions CI/CD
│   └── build.yml                # 빌드 및 릴리스
├── plans/
│   └── ARCHITECTURE.md          # 아키텍처 설계 문서
├── config.example.yaml          # 설정 예시
├── .env.example                 # 환경변수 예시
├── package.json
├── tsconfig.json
└── README.md                    # 이 문서
```

### 빌드

```bash
# TypeScript 컴파일
npm run build

# 개발 모드 (watch)
npm run dev

# 단일 .exe 빌드 (Windows)
npm run pkg:build
```

### 로컬 개발

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (ts-node)
npm run dev

# 또는 빌드 후 실행
npm run build
npm start
```

### 환경변수 설정

```bash
# .env 파일 생성
copy .env.example .env

# 설정 편집
notepad .env
```

### 로그 레벨 변경

```yaml
# config.yaml
logging:
  level: "debug"  # 상세 로그
```

### 새로운 MCP 도구 추가

Bridge는 MCP 프로토콜을 투명하게 전달하므로, MCP 서버(`powerbi-modeling-mcp.exe`)에서 새 도구를 추가하면 자동으로 사용 가능합니다.

### 코드 스타일

- TypeScript strict 모드
- ESLint + Prettier (설정 예정)
- 변수/함수명: camelCase
- 파일명: kebab-case

---

## 🤝 기여하기

기여를 환영합니다! Pull Request를 제출하기 전에:

1. Fork 및 브랜치 생성
2. 코드 변경
3. 빌드 및 테스트 확인
4. PR 생성 with 상세 설명

### 이슈 리포팅

버그 리포트나 기능 제안은 [Issues](../../issues)에서 등록해주세요.

---

## 📄 라이선스

이 프로젝트는 [MIT License](LICENSE) 하에 배포됩니다.

```
MIT License

Copyright (c) 2025 Dream I System

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
...
```

전문은 [LICENSE](LICENSE) 파일 참조.

---

## 🙏 감사의 글

이 프로젝트는 다음 오픈소스 프로젝트를 참고하였습니다:

- [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol)
- Express.js, Winston, TypeScript 커뮤니티

---

## 📞 문의

- **개발사**: Dream I System
- **이슈 트래커**: [GitHub Issues](../../issues)
- **문서**: [plans/ARCHITECTURE.md](plans/ARCHITECTURE.md)

---

**Made with ❤️ for the Power BI and Copilot community**
