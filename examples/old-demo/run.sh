#!/bin/bash

# AgentBackend Web Demo Runner
# Simple runner for the web demo as a standard AgentBackend consumer

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[WebDemo]${NC} $1"
}

success() {
    echo -e "${GREEN}✅${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

error() {
    echo -e "${RED}❌${NC} $1"
}

# Show usage information
show_usage() {
    echo -e "${GREEN}🚀 AgentBackend Web Demo${NC}"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --help          Show this help message"
    echo "  --docker-check  Check Docker development environment"
    echo ""
    echo "Backend Options:"
    echo "  • Local Backend: Direct filesystem access (always available)"
    echo "  • Remote Backend: SSH to Docker container"
    echo ""
    echo "For Remote Backend development:"
    echo "  npm install --save-dev @agent-backend/docker-dev"
    echo "  npx @agent-backend/docker-dev start"
    echo ""
}

# Check Docker development environment
check_docker_env() {
    log "Checking for Docker development environment..."
    
    if command -v docker >/dev/null 2>&1; then
        if docker ps --format "table {{.Names}}" | grep -q "agent-backend"; then
            success "AgentBackend Docker environment is running"
            docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep "agent-backend"
        else
            warn "AgentBackend Docker environment not running"
            echo ""
            log "To start the Docker development environment:"
            echo "  npm install --save-dev @agent-backend/docker-dev"
            echo "  npx @agent-backend/docker-dev start"
        fi
    else
        warn "Docker not available"
        log "Remote Backend requires Docker for development"
    fi
}

# Parse command line arguments
SHOW_HELP=false
CHECK_DOCKER=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --help)
            SHOW_HELP=true
            shift
            ;;
        --docker-check)
            CHECK_DOCKER=true
            shift
            ;;
        *)
            error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution
main() {
    if [[ "$SHOW_HELP" == "true" ]]; then
        show_usage
        return 0
    fi
    
    if [[ "$CHECK_DOCKER" == "true" ]]; then
        check_docker_env
        return 0
    fi
    
    echo -e "${BLUE}"
    echo "🌟 AgentBackend Web Demo"
    echo "=========================="
    echo -e "${NC}"
    
    log "Starting web demo as AgentBackend consumer..."
    echo ""
    success "AgentBackend package will handle platform detection automatically"
    echo ""
    log "Backend options available in web demo:"
    echo "  🏠 Local Backend: Direct filesystem access (always works)"
    echo "  🐳 Remote Backend: SSH to Docker (use --docker-check to verify setup)"
    echo ""
    log "Starting Next.js development server..."
    echo ""
    
    npm run dev
}

# Handle script interruption
cleanup_on_interrupt() {
    echo ""
    log "Shutting down web demo..."
    exit 0
}

trap cleanup_on_interrupt INT TERM

# Run main function
main "$@"