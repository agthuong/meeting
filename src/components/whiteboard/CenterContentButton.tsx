import React from "react";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";

interface CenterContentButtonProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

const CenterContentButton: React.FC<CenterContentButtonProps> = ({ excalidrawAPI }) => {
  const handleClick = () => {
    if (excalidrawAPI) {
      const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
      if (elements && elements.length > 0) {
        excalidrawAPI.scrollToContent(undefined, {
          fitToViewport: true,
          viewportZoomFactor: 0.8,
          animate: true,
          duration: 500,
        });
      } else {
        console.log("Không có element nào, reset zoom mặc định.");
      }
    }
  };

  return (
    <button
      onClick={handleClick}
      style={{
        position: "fixed", // Giữ nút cố định trên màn hình
        bottom: "75px", // Cách mép dưới 20px
        left: "50%", // Đặt nút ở giữa màn hình theo chiều ngang
        transform: "translateX(-50%)", // Căn chỉnh đúng vào giữa
        zIndex: 1000,
        padding: "10px 70px", // Kích thước nhỏ hơn
        fontSize: "14px", // Giảm kích thước chữ
        backgroundColor: "#007bff", // Màu xanh dương nổi bật
        color: "#fff", // Chữ màu trắng
        border: "none",
        borderRadius: "20px", // Bo góc tròn hơn
        cursor: "pointer",
        boxShadow: "0 2px 6px rgba(255, 255, 255, 0.42)",
      }}
    >
      Back to center
    </button>
  );
};

export default CenterContentButton;
