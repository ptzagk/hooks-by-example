import React, {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef, useState
} from 'react';

// Tired of immutable update patterns? Take a look at immer, it's awesome!
import produce from 'immer';

// Hooks do not share any state between components, but we have context for it
const SortableContext = createContext();

// Our library needs DOM nodes of every single item we want to reorder
// This custom hook will add React ref to the element and then push respective DOM node to the array on nodes on mount
function useSortableElement() {
  const ref = useRef(null);
  const { addNode } = useContext(SortableContext);

  useEffect(() => {
    addNode(ref.current);
  }, []);

  return {
    ref,
    style: {
      userSelect: 'none'
    }
  };
}

// We pass initial array of items to this hook which will reorder them after every 'dragEnd'
// Our component will then be automatically notified about it and rerender
function useSortable(initialItems) {
  const [items, setItems] = useState(initialItems);
  const { isDragging, oldIndex, newIndex } = useContext(SortableContext);

  useEffect(() => {
    // When dragging has ended and had results
    if (isDragging === false && oldIndex !== newIndex) {
      // Move item from old index to new index in array
      setItems(produce(items, draft => {
        draft.splice(newIndex, 0, draft.splice(oldIndex, 1)[0]);
      }));
    }
  }, [isDragging]);

  return items;
}

// This is the whole state of the library is managed
// this "produce" stuff comes from immer and makes updating immutable data less painful
function reducer(state, action) {
  switch (action.type) {
    // When sortable components are mounted they are added to "elements" array
    case 'ADD_NODE':
      return produce(state, draft => {
        draft.nodes.push(action.payload);
      });
    case 'DRAG_START':
      return produce(state, draft => {
        draft.isDragging = true;
        draft.initialY = action.payload.initialY;
        draft.draggedElement = {
          node: action.payload.node,
          rect: action.payload.node.getBoundingClientRect()
        };
        draft.draggedElementIndex = state.nodes.findIndex(node => node === action.payload.node);
        // We won't actually manipulate the original draggable node, that's why we create a duplicate
        draft.duplicateNode = action.payload.node.cloneNode(true);
      });
    case 'DRAG_END':
      return produce(state, draft => {
        draft.isDragging = false;
      });
    case 'SET_CURRENT_Y':
      return produce(state, draft => {
        draft.currentY = action.payload
      });
    case 'SET_NEW_INDEX':
      return produce(state, draft => {
        draft.draggedElementNewIndex = action.payload
      });
    default:
      return state;
  }
}

function Sortable(props) {
  const initialState = {
    nodes: []
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  const containerRef = useRef();

  function addNode(node) {
    dispatch({ type: 'ADD_NODE', payload: node });
  }

  // Event handlers
  function dragStart(e) {
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    if (state.nodes.some(node => node === e.target)) {
      dispatch({ type: 'DRAG_START', payload: { initialY: clientY, node: e.target } });
    }
  }

  function dragEnd() {
    dispatch({ type: 'DRAG_END' });
  }

  function drag(e) {
    if (state.isDragging) {
      e.preventDefault();

      const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
      dispatch({ type: 'SET_CURRENT_Y', payload: clientY - state.initialY });
    }
  }

  // Assignment of event handlers
  useEffect(() => {
    containerRef.current.addEventListener('mousedown', dragStart, false);
    window.addEventListener('mousemove', drag, false);
    window.addEventListener('mouseup', dragEnd, false);
    containerRef.current.addEventListener("touchstart", dragStart, false);
    window.addEventListener("touchend", dragEnd, false);
    window.addEventListener("touchmove", drag, false);
    // If your effect returns a function React will run it when it is time to clean up
    // This has similar logic to componentWillUnmount
    return () => {
      containerRef.current.removeEventListener('mousedown', dragStart, false);
      window.removeEventListener('mousemove', drag, false);
      window.removeEventListener('mouseup', dragEnd, false);
      containerRef.current.removeEventListener("touchstart", dragStart, false);
      window.removeEventListener("touchend", dragEnd, false);
      window.removeEventListener("touchmove", drag, false);
    }
    // So this part here is confusing
    // Theoretically all of our event listeners should only be initialized on mount (useEffect(..., []))
    // But our event handlers depend on some variables which won't be updated unless we specify them here
    // But it also means that our event handlers will be reassigned every time these variables change
    // https://github.com/facebook/react/issues/14092#issuecomment-435907249
    // "This is a known limitation. We want to provide a better solution"
  }, [state.nodes, state.isDragging]);

  // Stuff we do when dragging started/ended
  useEffect(() => {
    if (state.isDragging) {
      const originalRect = state.draggedElement.node.getBoundingClientRect();

      // We don't manipulate the original draggable node, but the duplicate
      // We append it to body, position exactly above original, move it around the page and remove after dragging has ended
      state.duplicateNode.style.position = 'absolute';
      state.duplicateNode.style.left = `${originalRect.left}px`;
      state.duplicateNode.style.top = `${originalRect.top}px`;
      state.duplicateNode.style.height = `${originalRect.height}px`;
      state.duplicateNode.style.width = `${originalRect.width}px`;

      document.body.appendChild(state.duplicateNode);

      // Hide original node
      state.draggedElement.node.style.visibility = 'hidden';

      // We want to animate our nodes
      state.nodes.forEach((node, i) => {
        if (i !== state.draggedElement.draggedElement) {
          node.style.webkitTransition = 'transform 0.3s';
        }
      });
    } else {
      if (state.draggedElement) {
        // Cleanup after dragging has ended
        // Remove duplicate, show original node, remove transformations and transitions
        document.body.removeChild(state.duplicateNode);
        state.draggedElement.node.style.visibility = 'visible';
        state.nodes.forEach(node => {
          node.style.webkitTransition = '';
          node.style.transform = '';
        });
      }
    }
  }, [state.isDragging]);

  useEffect(() => {
    if (state.duplicateNode) {
      // Move duplicate node across the screen
      // We don't use HTML5 drag and drop API and do the whole dragging animation manually
      state.duplicateNode.style.transform = `translate3d(0, ${state.currentY}px, 0)`;

      const draggedRect = state.draggedElement.rect;
      const offset = state.currentY + draggedRect.y + draggedRect.height / 2;

      const draggedElementIndex = state.draggedElementIndex;

      // Computer science baby! This is where reordering animation happens
      // Every time cursor position changes we decide which node to move up/down using translate3D
      // Algorithm is crappy, but the purpose of this library is not to become better at algorithms
      state.nodes.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        // We do nothing with the node that is currently dragged
        if (index !== draggedElementIndex) {
          if (offset > rect.y && draggedElementIndex < index) {
            state.nodes[index].style.transform = `translate3d(0, -${draggedRect.height}px, 0)`;
          } else if (offset < rect.y + rect.height && draggedElementIndex > index) {
            state.nodes[index].style.transform = `translate3d(0, ${draggedRect.height}px, 0)`;
          } else {
            state.nodes[index].style.transform = `translate3d(0, 0, 0)`;
          }
        }

        // Update newIndex in state, we will expose this variable to children
        if (offset > rect.y && offset < rect.y + rect.height) {
          dispatch({ type: 'SET_NEW_INDEX', payload: index });
        }
      });
    }
  }, [state.currentY]);

  // We decide what to expose to child components through context
  const ctx = {
    addNode,
    isDragging: state.isDragging,
    oldIndex: state.draggedElementIndex,
    newIndex: state.draggedElementNewIndex
  };

  return <SortableContext.Provider value={ctx}>
    <div ref={containerRef} style={{ touchAction: 'none' }}>{props.children}</div>
  </SortableContext.Provider>;
}

export default Sortable;

export {
  useSortable,
  useSortableElement
}